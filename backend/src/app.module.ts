import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GrocyModule } from './grocy/grocy.module';

function envToBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'better-sqlite3' as const,
        database: process.env.DB_PATH ?? 'mealer.sqlite',
        autoLoadEntities: envToBoolean(process.env.DB_AUTO_LOAD_ENTITIES, true),
        synchronize: envToBoolean(process.env.DB_SYNCHRONIZE, false),
        logging: envToBoolean(process.env.DB_LOGGING, false),
      }),
    }),
    GrocyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
