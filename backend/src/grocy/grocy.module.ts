import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { GrocyController } from './grocy.controller';
import { GrocyService } from './grocy.service';

@Module({
  imports: [HttpModule],
  controllers: [GrocyController],
  providers: [GrocyService],
})
export class GrocyModule {}
