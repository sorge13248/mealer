import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrocyModule } from '../grocy/grocy.module';
import { SpesaController } from './spesa.controller';
import { SpesaService } from './spesa.service';

@Module({
  imports: [GrocyModule, TypeOrmModule.forFeature([])],
  controllers: [SpesaController],
  providers: [SpesaService],
})
export class SpesaModule {}
