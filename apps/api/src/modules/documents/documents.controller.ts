import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Principal, UploadedFileLike } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { DocumentsService } from './documents.service.js';
import {
  AcknowledgementUploadDto,
  CreateCategoryDto,
  DocumentQueryDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from './dto/document.dto.js';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequirePermissions('documents.view')
  @ApiOperation({ summary: 'List documents within the caller’s scope' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: DocumentQueryDto) {
    return this.documents.list(principal, query);
  }

  @Get('categories')
  @RequirePermissions('documents.view')
  @ApiOperation({ summary: 'Document categories' })
  categories() {
    return this.documents.listCategories();
  }

  @Post('categories')
  @RequirePermissions('documents.manage')
  @Audited('DocumentCategory')
  @ApiOperation({ summary: 'Create a document category' })
  createCategory(@CurrentPrincipal() principal: Principal, @Body() dto: CreateCategoryDto) {
    return this.documents.createCategory(principal, dto);
  }

  @Get('expiring')
  @RequirePermissions('documents.view')
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiOperation({ summary: 'Documents nearing their expiry date' })
  expiring(@CurrentPrincipal() principal: Principal, @Query('days') days?: string) {
    return this.documents.expiring(principal.tenantId!, days ? Number(days) : 30);
  }

  @Get(':id')
  @RequirePermissions('documents.view')
  @ApiOperation({ summary: 'Document detail with version history' })
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.documents.get(principal, id);
  }

  @Post()
  @RequirePermissions('documents.upload')
  @Audited('Document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        employeeId: { type: 'string', format: 'uuid' },
        categoryId: { type: 'string', format: 'uuid' },
        expiresAt: { type: 'string', format: 'date' },
      },
      required: ['file', 'name'],
    },
  })
  @ApiOperation({ summary: 'Upload a document (version 1)' })
  upload(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.documents.upload(principal, dto, file);
  }

  @Post(':id/versions')
  @RequirePermissions('documents.upload')
  @Audited('DocumentVersion')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a new version of a document' })
  addVersion(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.documents.addVersion(principal, id, file);
  }

  @Patch(':id')
  @RequirePermissions('documents.manage')
  @Audited('Document')
  @ApiOperation({ summary: 'Update document metadata' })
  update(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.documents.update(principal, id, dto);
  }

  @Get(':id/download')
  @RequirePermissions('documents.view')
  @ApiQuery({ name: 'version', required: false })
  @ApiOperation({ summary: 'Time-limited download URL (presigned for S3)' })
  download(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Query('version') version?: string) {
    return this.documents.download(principal, id, version ? Number(version) : undefined);
  }

  @Post(':id/acknowledge')
  @RequirePermissions('documents.acknowledge')
  @Audited('DocumentAcknowledgment')
  @ApiOperation({ summary: 'Digitally acknowledge a document assigned to you' })
  acknowledge(
    @CurrentPrincipal() principal: Principal,
    @Req() request: Request,
    @Param('id') id: string,
    @Body() dto: AcknowledgementUploadDto,
  ) {
    return this.documents.acknowledge(principal, id, request.ip, dto.signature);
  }

  @Delete(':id')
  @RequirePermissions('documents.manage')
  @Audited('Document')
  @ApiOperation({ summary: 'Archive a document' })
  remove(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.documents.remove(principal, id);
  }
}
