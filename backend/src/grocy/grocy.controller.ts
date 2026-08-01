import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Redirect,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { GrocyService } from './grocy.service';

@Controller('grocy')
export class GrocyController {
  constructor(private readonly grocyService: GrocyService) {}

  @Get('products')
  async getProducts(): Promise<unknown> {
    return this.grocyService.getProducts();
  }

  @Get('stock')
  async getStock(): Promise<unknown> {
    return this.grocyService.getStock();
  }

  @Get('stock/volatile')
  async getVolatileStock(): Promise<unknown> {
    return this.grocyService.getVolatileStock();
  }

  @Post('stock/products/:productId/consume')
  async consumeProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.grocyService.consumeProduct(productId, body);
  }

  @Get('files/productpictures/:encodedFileName')
  @Header('Content-Disposition', 'inline')
  async getProductPicture(
    @Param('encodedFileName') encodedFileName: string,
    @Res() response: Response,
  ): Promise<void> {
    const picture = await this.grocyService.getProductPictureByEncodedName(encodedFileName);

    if (picture.contentType) {
      response.setHeader('Content-Type', picture.contentType);
    }

    if (picture.contentLength) {
      response.setHeader('Content-Length', picture.contentLength);
    }

    if (picture.cacheControl) {
      response.setHeader('Cache-Control', picture.cacheControl);
    }

    response.status(200).send(picture.data);
  }

  @Get('product/:productId')
  @Redirect()
  redirectToProductPage(@Param('productId', ParseIntPipe) productId: number): { url: string } {
    return {
      url: this.grocyService.getProductPageUrl(productId),
    };
  }
}
