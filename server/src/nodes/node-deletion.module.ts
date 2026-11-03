import { Module } from '@nestjs/common';
import { NodeDeletionService } from './node-deletion.service';

@Module({
  providers: [NodeDeletionService],
  exports: [NodeDeletionService],
})
export class NodeDeletionModule {}
