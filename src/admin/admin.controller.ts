import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Req,
  UnsupportedMediaTypeException
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { validateDto } from '../common/validation';
import { ApiErrorDto } from '../common/error.dto';
import {
  parseJsonField,
  PublishTrackDto,
  PublishTrackFormDto,
  ReplaceAudioFieldsDto,
  ReplaceAudioFormDto,
  UpdateAlbumDto,
  UpdateArtistDto,
  UpdateTrackDto,
  UploadCoverFormDto
} from './admin.dto';
import {
  AdminArtistDto,
  AdminCatalogDto,
  AdminTrackDto,
  CoverUploadResultDto,
  PublishTrackResultDto,
  UpdateAlbumResultDto
} from './admin.responses';
import { AdminService } from './admin.service';
import { AllowServiceToken, Roles } from '../auth/auth.decorators';
import { Role } from '../../generated/prisma/enums';

const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;

const TRACK_IDENTIFIER = {
  name: 'identifier',
  description: 'UUID de la pista, su slug canónico, o un identificador antiguo `tr-*`.',
  example: 'get-lucky'
} as const;

interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

interface MultipartUpload {
  file: UploadedFile;
  fields: Record<string, unknown>;
}

/**
 * Lee un multipart con varios archivos opcionales.
 *
 * `readMultipart` espera exactamente uno y falla si llega otro; publicar manda
 * el audio y, si la hay, la portada, así que necesita recogerlos por nombre en
 * lugar de rechazar el segundo.
 */
async function readMultipartFiles(
  request: FastifyRequest,
  expected: Record<string, number>
): Promise<{ files: Record<string, UploadedFile>; fields: Record<string, unknown> }> {
  if (!request.isMultipart()) throw new UnsupportedMediaTypeException('Expected multipart/form-data');

  const maxBytes = Math.max(...Object.values(expected));
  const files: Record<string, UploadedFile> = {};
  const fields: Record<string, unknown> = {};

  try {
    const parts = request.parts({
      limits: { files: Object.keys(expected).length, fields: 10, fileSize: maxBytes }
    });
    for await (const part of parts) {
      if (part.type === 'field') {
        fields[part.fieldname] = part.value;
        continue;
      }
      const limit = expected[part.fieldname];
      if (limit === undefined) {
        part.file.resume();
        throw new BadRequestException(`Unexpected file field '${part.fieldname}'`);
      }
      const buffer = await part.toBuffer();
      if (part.file.truncated || buffer.length > limit) {
        throw new PayloadTooLargeException(
          `'${part.fieldname}' exceeds the ${Math.floor(limit / 1024 / 1024)} MB limit`
        );
      }
      files[part.fieldname] = { buffer, filename: part.filename, mimetype: part.mimetype };
    }
  } catch (error) {
    multipartError(error, maxBytes);
  }

  return { files, fields };
}

function apiUrl(host: string, protocol: string): string {
  return (process.env.PUBLIC_API_URL || `${protocol}://${host}/v1`).replace(/\/$/, '');
}

function multipartError(error: unknown, maxBytes: number): never {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') {
    throw new PayloadTooLargeException(`Upload exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
  }
  throw error;
}

async function readMultipart(request: FastifyRequest, fieldName: string, maxBytes: number): Promise<MultipartUpload> {
  if (!request.isMultipart()) throw new UnsupportedMediaTypeException('Expected multipart/form-data');

  let uploadedFile: MultipartUpload['file'] | undefined;
  const fields: Record<string, unknown> = {};
  try {
    const parts = request.parts({ limits: { files: 1, fields: 5, fileSize: maxBytes } });
    for await (const part of parts) {
      if (part.type === 'field') {
        fields[part.fieldname] = part.value;
        continue;
      }
      if (part.fieldname !== fieldName) {
        part.file.resume();
        throw new BadRequestException(`Expected file field '${fieldName}'`);
      }
      const buffer = await part.toBuffer();
      if (part.file.truncated || buffer.length > maxBytes) {
        throw new PayloadTooLargeException(`Upload exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
      }
      uploadedFile = { buffer, filename: part.filename, mimetype: part.mimetype };
    }
  } catch (error) {
    multipartError(error, maxBytes);
  }

  if (!uploadedFile) throw new BadRequestException(`File field '${fieldName}' is required`);
  return { file: uploadedFile, fields };
}

/**
 * Mantenimiento del catálogo. Dos formas de entrar, y ninguna más:
 *
 * una sesión con rol `ADMIN` —la que usa el mantenedor desde la web— o la
 * cabecera `X-Pulse-Admin-Token`, reservada a los procesos sin persona detrás
 * como `pulse-dl`. El token dejó de ser la llave del navegador: un secreto
 * compartido que abre el catálogo entero no puede vivir en un cliente.
 */
@ApiTags('Admin')
@ApiBearerAuth('BearerAuth')
@ApiSecurity('AdminToken')
@ApiUnauthorizedResponse({ description: 'Sin sesión válida ni token de servicio.', type: ApiErrorDto })
@ApiForbiddenResponse({ description: 'La sesión es válida pero la cuenta no es ADMIN.', type: ApiErrorDto })
@Controller('admin')
@Roles(Role.ADMIN)
@AllowServiceToken()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('tracks')
  @ApiOperation({
    operationId: 'listAdminTracks',
    summary: 'Listar el catálogo completo para mantenimiento',
    description: 'Incluye las pistas en espera, que no aparecen en `/catalog`, y los álbumes a los que se pueden mover.'
  })
  @ApiOkResponse({ type: AdminCatalogDto })
  listTracks(@Headers('host') host = 'localhost:4000', @Headers('x-forwarded-proto') protocol = 'http') {
    return this.admin.listTracks(apiUrl(host, protocol));
  }

  @Patch('tracks/:identifier')
  @ApiOperation({ operationId: 'updateAdminTrack', summary: 'Editar los metadatos de una pista' })
  @ApiParam(TRACK_IDENTIFIER)
  @ApiOkResponse({ type: AdminTrackDto })
  @ApiBadRequestResponse({ description: 'Metadatos inválidos, o el álbum destino no existe.', type: ApiErrorDto })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.', type: ApiErrorDto })
  updateTrack(
    @Param('identifier') identifier: string,
    @Body() body: UpdateTrackDto,
    @Headers('host') host = 'localhost:4000',
    @Headers('x-forwarded-proto') protocol = 'http'
  ) {
    return this.admin.updateTrack(identifier, body, apiUrl(host, protocol));
  }

  /**
   * Corregir el año de un disco es lo que saca del limbo a sus pistas: es el
   * único dato que las retiene y no se podía tocar desde ningún sitio.
   */
  @Patch('albums/:id')
  @ApiOperation({
    operationId: 'updateAdminAlbum',
    summary: 'Editar un álbum y rescatar sus pistas en espera',
    description:
      'El año es el único dato que retiene pistas fuera del catálogo. Al corregirlo se publican las que solo esperaban eso; una pista retirada a mano no vuelve.'
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'UUID del álbum.' })
  @ApiOkResponse({ type: UpdateAlbumResultDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos o cuerpo sin nada que cambiar.', type: ApiErrorDto })
  @ApiNotFoundResponse({ description: 'No existe ningún álbum con ese UUID.', type: ApiErrorDto })
  updateAlbum(
    @Param('id') id: string,
    @Body() body: UpdateAlbumDto,
    @Headers('host') host = 'localhost:4000',
    @Headers('x-forwarded-proto') protocol = 'http'
  ) {
    return this.admin.updateAlbum(id, body, apiUrl(host, protocol));
  }

  @Patch('artists/:id')
  @ApiOperation({
    operationId: 'updateAdminArtist',
    summary: 'Editar la ficha de un artista',
    description:
      'Géneros, reseña y retrato. El primer género es el que hereda cada pista suya que se publique sin género, así que corregirlo aquí evita que sigan cayendo en «Sin clasificar». Una publicación nunca pisa estos datos: este es el único sitio donde se cambian.'
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'UUID del artista.' })
  @ApiOkResponse({ type: AdminArtistDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos o cuerpo sin nada que cambiar.', type: ApiErrorDto })
  @ApiNotFoundResponse({ description: 'No existe ningún artista con ese UUID.', type: ApiErrorDto })
  updateArtist(
    @Param('id') id: string,
    @Body() body: UpdateArtistDto,
    @Headers('host') host = 'localhost:4000',
    @Headers('x-forwarded-proto') protocol = 'http'
  ) {
    return this.admin.updateArtist(id, body, apiUrl(host, protocol));
  }

  @Post('tracks/:identifier/audio')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'replaceAdminTrackAudio',
    summary: 'Reemplazar el audio de una pista ya publicada',
    description:
      'El archivo se guarda por el hash de su contenido, así que el `streamUrl` que devuelve trae una versión nueva y los clientes no reutilizan el MP3 anterior.'
  })
  @ApiParam(TRACK_IDENTIFIER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ReplaceAudioFormDto })
  @ApiOkResponse({ type: AdminTrackDto })
  @ApiBadRequestResponse({ description: 'El archivo no es un MP3 válido, o falta la duración.', type: ApiErrorDto })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.', type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ description: 'El audio pasa de 60 MB.', type: ApiErrorDto })
  async replaceAudio(
    @Param('identifier') identifier: string,
    @Req() request: FastifyRequest,
    @Headers('host') host = 'localhost:4000',
    @Headers('x-forwarded-proto') protocol = 'http'
  ) {
    const upload = await readMultipart(request, 'audio', MAX_AUDIO_BYTES);
    const { duration } = validateDto(ReplaceAudioFieldsDto, { duration: upload.fields.duration });
    return this.admin.replaceAudio(identifier, upload.file, duration, apiUrl(host, protocol));
  }

  @Post('covers')
  @HttpCode(201)
  @ApiOperation({
    operationId: 'uploadAdminCover',
    summary: 'Subir una portada',
    description:
      'Devuelve la ruta ya servible. Se guarda por el hash del contenido, así que subir dos veces la misma imagen no ocupa el doble.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadCoverFormDto })
  @ApiCreatedResponse({ type: CoverUploadResultDto })
  @ApiBadRequestResponse({ description: 'El archivo no es un JPG, PNG o WebP válido.', type: ApiErrorDto })
  @ApiPayloadTooLargeResponse({ description: 'La imagen pasa de 5 MB.', type: ApiErrorDto })
  async uploadCover(@Req() request: FastifyRequest) {
    const upload = await readMultipart(request, 'cover', MAX_COVER_BYTES);
    return this.admin.uploadCover(upload.file);
  }

  /**
   * Alta de una pista con su audio: la puerta de entrada al catálogo.
   *
   * Es idempotente por slug, así que reenviar una pista ya publicada la
   * actualiza. Eso permite reintentar una subida cortada sin comprobar nada.
   */
  @Post('tracks')
  @HttpCode(201)
  @ApiExtraModels(PublishTrackDto)
  @ApiOperation({
    operationId: 'publishTrack',
    summary: 'Publicar una pista con su audio',
    description:
      'Única puerta de entrada al catálogo. Es idempotente por slug: reenviar una pista ya publicada la actualiza en vez de duplicarla, así que una subida cortada se puede reintentar tal cual. Lo que llega incompleto entra pero queda en espera, y se publica solo cuando no falta nada (ver `pending`).'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: PublishTrackFormDto })
  @ApiCreatedResponse({ type: PublishTrackResultDto })
  @ApiBadRequestResponse({ description: 'Metadatos inválidos, o el audio no es un MP3 válido.', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'Ese mismo audio, byte a byte, ya está publicado con otro slug.',
    type: ApiErrorDto
  })
  @ApiPayloadTooLargeResponse({ description: 'El audio pasa de 60 MB o la portada de 5 MB.', type: ApiErrorDto })
  async publishTrack(@Req() request: FastifyRequest) {
    const upload = await readMultipartFiles(request, {
      audio: MAX_AUDIO_BYTES,
      cover: MAX_COVER_BYTES
    });

    const audio = upload.files.audio;
    if (!audio) throw new BadRequestException("File field 'audio' is required");

    return this.admin.publishTrack(
      validateDto(PublishTrackDto, parseJsonField(upload.fields.data, 'data')),
      audio,
      upload.files.cover
    );
  }
}