import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Logger,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  SpesaService,
  type MatchCandidatesRequest,
  type MatchCandidatesResponse,
  type ParsedReceiptResponse,
  type SaveReceiptRequest,
  type SaveReceiptResponse,
  type SaveMappingsRequest,
  type SaveMappingsResponse,
  type StoredReceiptDetailResponse,
  type StoredReceiptListResponse,
  type DeleteStoredReceiptResponse,
  type ShoppingInsightsResponse,
} from './spesa.service';

const MAX_RECEIPT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@Controller('spesa')
export class SpesaController {
  private readonly logger = new Logger(SpesaController.name);

  constructor(private readonly spesaService: SpesaService) {}

  @Get('receipts')
  async getStoredReceipts(
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ): Promise<StoredReceiptListResponse> {
    const parsedPage = Number(pageRaw);
    const page = Number.isFinite(parsedPage) ? parsedPage : undefined;

    const parsedPageSize = Number(pageSizeRaw);
    const pageSize = Number.isFinite(parsedPageSize)
      ? parsedPageSize
      : undefined;

    return this.spesaService.getStoredReceipts({ page, pageSize });
  }

  @Get('receipts/:receiptId')
  async getStoredReceiptDetail(
    @Param('receiptId') receiptIdRaw: string,
  ): Promise<StoredReceiptDetailResponse> {
    const receiptId = Number(receiptIdRaw);
    if (!Number.isInteger(receiptId) || receiptId <= 0) {
      throw new BadRequestException('ID scontrino non valido.');
    }

    return this.spesaService.getStoredReceiptDetail(receiptId);
  }

  @Delete('receipts/:receiptId')
  async deleteStoredReceipt(
    @Param('receiptId') receiptIdRaw: string,
  ): Promise<DeleteStoredReceiptResponse> {
    const receiptId = Number(receiptIdRaw);
    if (!Number.isInteger(receiptId) || receiptId <= 0) {
      throw new BadRequestException('ID scontrino non valido.');
    }

    return this.spesaService.deleteStoredReceipt(receiptId);
  }

  @Get('insights')
  async getShoppingInsights(
    @Query('days') daysRaw?: string,
    @Query('productIds') productIdsRaw?: string,
  ): Promise<ShoppingInsightsResponse> {
    const parsedDays = Number(daysRaw);
    const days = Number.isFinite(parsedDays) ? parsedDays : undefined;
    const productIds =
      typeof productIdsRaw === 'string'
        ? productIdsRaw
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value) && value > 0)
        : undefined;

    return this.spesaService.getShoppingInsights({
      days,
      productIds,
    });
  }

  @Post('receipt/parse')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('receipt', {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_RECEIPT_FILE_SIZE_BYTES,
      },
    }),
  )
  async parseReceipt(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ParsedReceiptResponse> {
    if (!file) {
      throw new BadRequestException(
        'File scontrino mancante nel campo "receipt".',
      );
    }

    this.logger.log(
      `parseReceipt file=${file.originalname} mime=${file.mimetype} bytes=${file.size}`,
    );

    return this.spesaService.parseReceiptFile(file);
  }

  @Post('match/candidates')
  @HttpCode(HttpStatus.OK)
  async getMatchCandidates(
    @Body() body: MatchCandidatesRequest,
  ): Promise<MatchCandidatesResponse> {
    return this.spesaService.getMatchCandidates(body);
  }

  @Post('mappings')
  @HttpCode(HttpStatus.OK)
  async saveMappings(
    @Body() body: SaveMappingsRequest,
  ): Promise<SaveMappingsResponse> {
    return this.spesaService.saveMappings(body);
  }

  @Post('receipt/save')
  @HttpCode(HttpStatus.OK)
  async saveReceipt(
    @Body() body: SaveReceiptRequest,
  ): Promise<SaveReceiptResponse> {
    return this.spesaService.saveReceipt(body);
  }
}
