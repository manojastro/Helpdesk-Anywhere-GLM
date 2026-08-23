import { Module } from '@nestjs/common';
import { IceConfigController } from './ice.controller';

@Module({
  controllers: [IceConfigController],
})
export class IceConfigModule {}
