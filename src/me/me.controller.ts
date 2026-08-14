import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';

import { ApiErrorDto } from '../common/error.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/authentication.guard';
import {
  CreatePlaylistDto,
  LogPlayDto,
  UpdatePlaylistDto,
  UpdatePreferencesDto,
  UpdateProfileDto
} from './me.dto';
import { UserProfileDto } from '../auth/auth.responses';
import {
  AlbumSaveResultDto,
  ArtistFollowResultDto,
  FavouriteResultDto,
  HistoryEntryDto,
  LibraryDto,
  PlaylistDto,
  PreferencesDto
} from './me.responses';
import { MeService } from './me.service';

const TRACK_PARAM = {
  name: 'trackId',
  description: 'UUID de la pista, su slug canónico, o un identificador antiguo `tr-*`.',
  example: 'get-lucky'
} as const;

/**
 * La biblioteca de quien llama.
 *
 * Ningún endpoint recibe un identificador de usuario: siempre sale del token.
 * Aceptarlo por parámetro convertiría cada ruta en una forma de leer o editar
 * la biblioteca ajena sin más que cambiar un número.
 */
@ApiTags('Biblioteca')
@ApiBearerAuth('BearerAuth')
@ApiUnauthorizedResponse({ description: 'Falta el access token, o no es válido.', type: ApiErrorDto })
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Patch('profile')
  @ApiOperation({
    operationId: 'updateProfile',
    summary: 'Cambiar los datos de la cuenta',
    description:
      'El nombre y el avatar. El correo no se toca aquí: es la identidad con la que se inicia sesión y cambiarlo exige verificar antes el buzón nuevo.'
  })
  @ApiOkResponse({ type: UserProfileDto })
  updateProfile(@CurrentUser() user: Principal, @Body() body: UpdateProfileDto) {
    return this.me.updateProfile(user.sub, body);
  }

  @Get('library')
  @ApiOperation({
    operationId: 'getLibrary',
    summary: 'Biblioteca completa',
    description: 'Favoritos, álbumes guardados, artistas seguidos, historial reciente y preferencias, de una vez.'
  })
  @ApiOkResponse({ type: LibraryDto })
  getLibrary(@CurrentUser() user: Principal) {
    return this.me.getLibrary(user.sub);
  }

  // -------------------------------------------------------------------
  // Favoritos, álbumes y artistas
  // -------------------------------------------------------------------

  @Put('favourites/:trackId')
  @ApiOperation({ operationId: 'addFavourite', summary: 'Marcar una pista como favorita' })
  @ApiParam(TRACK_PARAM)
  @ApiOkResponse({ type: FavouriteResultDto })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.', type: ApiErrorDto })
  addFavourite(@CurrentUser() user: Principal, @Param('trackId') trackId: string) {
    return this.me.addFavourite(user.sub, trackId);
  }

  @Delete('favourites/:trackId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'removeFavourite', summary: 'Quitar una pista de favoritos' })
  @ApiParam(TRACK_PARAM)
  @ApiNoContentResponse({ description: 'Quitada, o no estaba: el resultado es el mismo.' })
  removeFavourite(@CurrentUser() user: Principal, @Param('trackId') trackId: string) {
    return this.me.removeFavourite(user.sub, trackId);
  }

  @Put('albums/:albumId')
  @ApiOperation({ operationId: 'saveAlbum', summary: 'Guardar un álbum en la biblioteca' })
  @ApiParam({ name: 'albumId', description: 'UUID del álbum, su slug, o un identificador `al-*`.' })
  @ApiOkResponse({ type: AlbumSaveResultDto })
  @ApiNotFoundResponse({ description: 'No existe ningún álbum con ese identificador.', type: ApiErrorDto })
  saveAlbum(@CurrentUser() user: Principal, @Param('albumId') albumId: string) {
    return this.me.saveAlbum(user.sub, albumId);
  }

  @Delete('albums/:albumId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'removeAlbum', summary: 'Quitar un álbum de la biblioteca' })
  @ApiParam({ name: 'albumId', description: 'UUID del álbum, su slug, o un identificador `al-*`.' })
  @ApiNoContentResponse({ description: 'Quitado, o no estaba.' })
  removeAlbum(@CurrentUser() user: Principal, @Param('albumId') albumId: string) {
    return this.me.removeAlbum(user.sub, albumId);
  }

  @Put('artists/:artistId')
  @ApiOperation({ operationId: 'followArtist', summary: 'Seguir a un artista' })
  @ApiParam({ name: 'artistId', description: 'UUID del artista, su slug, o un identificador `ar-*`.' })
  @ApiOkResponse({ type: ArtistFollowResultDto })
  @ApiNotFoundResponse({ description: 'No existe ningún artista con ese identificador.', type: ApiErrorDto })
  followArtist(@CurrentUser() user: Principal, @Param('artistId') artistId: string) {
    return this.me.followArtist(user.sub, artistId);
  }

  @Delete('artists/:artistId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'unfollowArtist', summary: 'Dejar de seguir a un artista' })
  @ApiParam({ name: 'artistId', description: 'UUID del artista, su slug, o un identificador `ar-*`.' })
  @ApiNoContentResponse({ description: 'Ya no se sigue, tanto si se seguía como si no.' })
  unfollowArtist(@CurrentUser() user: Principal, @Param('artistId') artistId: string) {
    return this.me.unfollowArtist(user.sub, artistId);
  }

  // -------------------------------------------------------------------
  // Historial
  // -------------------------------------------------------------------

  @Post('history')
  @HttpCode(201)
  @ApiOperation({
    operationId: 'logPlay',
    summary: 'Registrar una reproducción',
    description: 'El cliente decide cuándo cuenta como escucha, y no manda nada si la sesión privada está activa.'
  })
  @ApiCreatedResponse({ type: HistoryEntryDto })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.', type: ApiErrorDto })
  logPlay(@CurrentUser() user: Principal, @Body() body: LogPlayDto) {
    return this.me.logPlay(user.sub, body.trackId, body.progress ?? 0, body.completed ?? false);
  }

  @Delete('history/:entryId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'removeHistoryEntry', summary: 'Borrar una entrada del historial' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Borrada, o no era tuya: en ningún caso se dice cuál de las dos.' })
  removeHistoryEntry(@CurrentUser() user: Principal, @Param('entryId') entryId: string) {
    return this.me.removeHistoryEntry(user.sub, entryId);
  }

  @Delete('history')
  @HttpCode(204)
  @ApiOperation({ operationId: 'clearHistory', summary: 'Vaciar el historial' })
  @ApiNoContentResponse({ description: 'Historial vacío.' })
  clearHistory(@CurrentUser() user: Principal) {
    return this.me.clearHistory(user.sub);
  }

  // -------------------------------------------------------------------
  // Preferencias
  // -------------------------------------------------------------------

  @Get('preferences')
  @ApiOperation({
    operationId: 'getPreferences',
    summary: 'Preferencias de la cuenta',
    description:
      'Siempre responde con valores: una cuenta que no ha guardado nada recibe los de fábrica, no un hueco. Existe porque un recurso que se puede cambiar tiene que poder leerse sin pedir la biblioteca entera.'
  })
  @ApiOkResponse({ type: PreferencesDto })
  getPreferences(@CurrentUser() user: Principal) {
    return this.me.getPreferences(user.sub);
  }

  @Patch('preferences')
  @ApiOperation({
    operationId: 'updatePreferences',
    summary: 'Cambiar las preferencias',
    description: 'Crea la fila si la cuenta todavía no tenía preferencias guardadas.'
  })
  @ApiOkResponse({ type: PreferencesDto })
  updatePreferences(@CurrentUser() user: Principal, @Body() body: UpdatePreferencesDto) {
    return this.me.updatePreferences(user.sub, body);
  }

  // -------------------------------------------------------------------
  // Playlists
  // -------------------------------------------------------------------

  @Get('playlists')
  @ApiOperation({ operationId: 'listPlaylists', summary: 'Playlists propias' })
  @ApiOkResponse({ type: [PlaylistDto] })
  listPlaylists(@CurrentUser() user: Principal) {
    return this.me.listPlaylists(user.sub);
  }

  @Post('playlists')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createPlaylist', summary: 'Crear una playlist' })
  @ApiCreatedResponse({ type: PlaylistDto })
  @ApiNotFoundResponse({ description: 'Alguna de las pistas indicadas no existe.', type: ApiErrorDto })
  createPlaylist(@CurrentUser() user: Principal, @Body() body: CreatePlaylistDto) {
    return this.me.createPlaylist(user.sub, body);
  }

  @Patch('playlists/:playlistId')
  @ApiOperation({
    operationId: 'updatePlaylist',
    summary: 'Editar una playlist',
    description: 'Si viene `trackIds`, sustituye la lista completa en ese orden: así se reordena y se quita a la vez.'
  })
  @ApiParam({ name: 'playlistId', format: 'uuid' })
  @ApiOkResponse({ type: PlaylistDto })
  @ApiNotFoundResponse({ description: 'No hay ninguna playlist tuya con ese identificador.', type: ApiErrorDto })
  updatePlaylist(
    @CurrentUser() user: Principal,
    @Param('playlistId') playlistId: string,
    @Body() body: UpdatePlaylistDto
  ) {
    return this.me.updatePlaylist(user.sub, playlistId, body);
  }

  @Delete('playlists/:playlistId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deletePlaylist', summary: 'Borrar una playlist' })
  @ApiParam({ name: 'playlistId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Borrada, o no era tuya.' })
  deletePlaylist(@CurrentUser() user: Principal, @Param('playlistId') playlistId: string) {
    return this.me.deletePlaylist(user.sub, playlistId);
  }
}
