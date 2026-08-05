import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrocyModule } from '../grocy/grocy.module';
import { AdobeScanPdfReceiptParserService } from './receipt-parsers/adobe-scan-pdf-receipt-parser.service';
import { CoopOfficialPdfReceiptParserService } from './receipt-parsers/coop-official-pdf-receipt-parser.service';
import { PhotoReceiptParserService } from './receipt-parsers/photo-receipt-parser.service';
import { ReceiptOcrEngineService } from './receipt-parsers/receipt-ocr-engine.service';
import { ReceiptParserDispatcherService } from './receipt-parsers/receipt-parser-dispatcher.service';
import { SelfHostedHttpReceiptOcrProvider } from './receipt-parsers/self-hosted-http-receipt-ocr.provider';
import { TesseractReceiptOcrProvider } from './receipt-parsers/tesseract-receipt-ocr.provider';
import { SpesaController } from './spesa.controller';
import { SpesaService } from './spesa.service';

@Module({
  imports: [GrocyModule, TypeOrmModule.forFeature([])],
  controllers: [SpesaController],
  providers: [
    SpesaService,
    ReceiptParserDispatcherService,
    ReceiptOcrEngineService,
    SelfHostedHttpReceiptOcrProvider,
    TesseractReceiptOcrProvider,
    CoopOfficialPdfReceiptParserService,
    AdobeScanPdfReceiptParserService,
    PhotoReceiptParserService,
  ],
})
export class SpesaModule {}
