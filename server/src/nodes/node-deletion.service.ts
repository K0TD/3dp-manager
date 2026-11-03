import { ConflictException, Injectable } from '@nestjs/common';

/** Coordinates node removal with rotations in this server process. */
@Injectable()
export class NodeDeletionService {
  private readonly deleting = new Set<string>();
  private readonly removed = new Set<string>();

  begin(id: string) {
    if (this.deleting.has(id)) {
      throw new ConflictException('Нода уже удаляется');
    }
    this.deleting.add(id);
  }

  end(id: string, removed: boolean) {
    this.deleting.delete(id);
    if (removed) this.removed.add(id);
  }

  isDeleting(id: string) {
    return this.deleting.has(id) || this.removed.has(id);
  }
}
