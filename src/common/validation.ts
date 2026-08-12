import { BadRequestException, type Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  registerDecorator,
  validateSync,
  ValidateIf,
  type ValidationError,
  type ValidationOptions
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Vocabulario de validación compartido.
 *
 * Los DTO son la única fuente de verdad: de ellos salen tanto los mensajes de
 * error como los esquemas que publica Swagger. Todo lo que antes vivía en
 * funciones sueltas está aquí como decoradores para que documentación y
 * validación no puedan separarse.
 */

/** Recorta los espacios antes de validar longitudes y patrones. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * Campo opcional que, si llega, no puede ser null.
 *
 * `@IsOptional()` de class-validator también deja pasar null, y un null que se
 * cuela acaba en Prisma como columna NOT NULL: falla mucho más tarde y con un
 * error peor.
 */
export const Optional = () => ValidateIf((_object, value) => value !== undefined);

/** Campo opcional en el que null es un valor con significado propio. */
export const NullableOptional = () =>
  ValidateIf((_object, value) => value !== undefined && value !== null);

/** Convierte texto a número: los campos de un multipart siempre llegan como texto. */
export const ToNumber = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? value : Number(trimmed);
  });

const COVER_PATH_PATTERN = /^\/media\/covers\/[A-Za-z0-9._-]+$/;

/** Portada: o una URL absoluta, o una ruta servida por este mismo API. */
export function IsCoverUrl(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isCoverUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length > 2048) return false;
          if (COVER_PATH_PATTERN.test(value)) return true;
          if (!/^https?:\/\//i.test(value)) return false;
          try {
            new URL(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage: () =>
          `${propertyName} must be an HTTP(S) URL or a /media/covers/ path`
      }
    });
  };
}

/**
 * Año de grabación plausible.
 *
 * Antes de 1877 no había grabaciones, y el tope evita que una errata se
 * publique como un disco del año 20250. Se calcula por petición a propósito:
 * un `@Max` fijo se evalúa al importar el módulo y caducaría en Nochevieja.
 */
export function IsRecordingYear(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isRecordingYear',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown): boolean =>
          Number.isInteger(value) &&
          (value as number) >= 1877 &&
          (value as number) <= new Date().getFullYear() + 1,
        defaultMessage: () => `${propertyName} must be a realistic four-digit year`
      }
    });
  };
}

/**
 * Regla de clase: un PATCH tiene que traer algo que cambiar.
 *
 * class-validator no tiene validación a nivel de clase, así que la restricción
 * se registra sobre una propiedad sintética y lee el objeto entero desde
 * `args.object`. No aparece en la entrada, así que `whitelist` la ignora.
 */
export function AtLeastOneField(fields: string[]) {
  return (target: object): void => {
    registerDecorator({
      name: 'atLeastOneField',
      target: target as Function,
      propertyName: '__atLeastOneField',
      validator: {
        validate: (_value: unknown, args): boolean => {
          const body = (args?.object ?? {}) as Record<string, unknown>;
          return fields.some((field) => body[field] !== undefined);
        },
        defaultMessage: () => `at least one field is required: ${fields.join(', ')}`
      }
    });
  };
}

/** Aplana los errores anidados a una lista de mensajes con la ruta del campo. */
function flattenErrors(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) =>
      parent && message.startsWith(`${error.property} `) ? `${parent}.${message}` : message
    );
    return [...own, ...flattenErrors(error.children ?? [], path)];
  });
}

/**
 * Valida un objeto ya parseado contra un DTO.
 *
 * El `ValidationPipe` global cubre los cuerpos JSON, pero las subidas llegan
 * como multipart y sus campos se leen a mano del stream; esto les aplica
 * exactamente las mismas reglas para que no haya dos formas de validar.
 */
export function validateDto<T extends object>(cls: Type<T>, plain: unknown): T {
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) {
    throw new BadRequestException('Request body must be a JSON object');
  }

  const instance = plainToInstance(cls, plain);
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true
  });
  if (errors.length > 0) throw new BadRequestException(flattenErrors(errors));

  return instance;
}