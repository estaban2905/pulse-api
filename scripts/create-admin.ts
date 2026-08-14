import 'dotenv/config';
import { Algorithm, hash as argonHash } from '@node-rs/argon2';

import { PrismaClient } from '../generated/prisma/client';
import { canonicalEmail } from '../src/common/email';
import { PrismaPg } from '@prisma/adapter-pg';
import { Role } from '../generated/prisma/enums';

/**
 * Crea o promueve la cuenta de administración.
 *
 * Existe porque el rol `ADMIN` no se puede pedir desde ningún endpoint: si
 * `/auth/register` aceptara un rol, cualquiera se daría de alta como
 * administrador. La primera cuenta con permisos tiene que nacer fuera del API,
 * y esta es la única puerta.
 *
 * Uso: npm run create-admin -- correo@ejemplo.com "una-contraseña-larga"
 *
 * Sobre una cuenta que ya existe cambia el rol a ADMIN y, si se pasa una
 * contraseña, también la reemplaza.
 */

const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
} as const;

const PASSWORD_MIN = 10;

function usage(message: string): never {
  console.error(`${message}\n\nUso: npm run create-admin -- <correo> <contraseña>`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [rawEmail, password] = process.argv.slice(2);
  if (!rawEmail) usage('Falta el correo.');

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage(`"${rawEmail}" no parece un correo.`);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) usage('Falta DATABASE_URL. Copia .env.example a .env y ajústalo.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // Por la forma canónica, igual que el registro: si no, escribir el correo
    // con un punto de más crearía una cuenta nueva en vez de promover la tuya.
    const emailKey = canonicalEmail(email);
    const existing = await prisma.user.findFirst({
      where: { OR: [{ emailKey }, { email }] },
      select: { id: true, role: true, email: true }
    });

    if (existing) {
      // Promover no exige contraseña nueva: lo normal es ascender una cuenta
      // que ya se usa, y pedirla obligaría a cambiarla sin motivo.
      const data: { role: Role; passwordHash?: string } = { role: Role.ADMIN };
      if (password) {
        if (password.length < PASSWORD_MIN) usage(`La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`);
        data.passwordHash = await argonHash(password, ARGON_OPTIONS);
      }

      await prisma.user.update({ where: { id: existing.id }, data });
      const changed = password ? ' y contraseña actualizada' : '';
      const shown = existing.email === email ? email : `${existing.email} (mismo buzón que ${email})`;
      console.log(
        existing.role === Role.ADMIN
          ? `${shown} ya era ADMIN${changed}.`
          : `${shown} promovido de ${existing.role} a ADMIN${changed}.`
      );
      return;
    }

    if (!password) usage('La cuenta no existe: hace falta una contraseña para crearla.');
    if (password.length < PASSWORD_MIN) usage(`La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`);

    await prisma.user.create({
      data: {
        email,
        emailKey,
        passwordHash: await argonHash(password, ARGON_OPTIONS),
        displayName: email.split('@')[0],
        role: Role.ADMIN,
        preferences: { create: {} }
      }
    });
    console.log(`Cuenta ADMIN creada: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
