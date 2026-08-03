import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
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
  type ShoppingInsightsResponse,
} from './spesa.service';

const MAX_RECEIPT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@Controller('spesa')
export class SpesaController {
  constructor(private readonly spesaService: SpesaService) {}

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
