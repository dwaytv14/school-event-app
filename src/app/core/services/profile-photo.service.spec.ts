import { TestBed } from '@angular/core/testing';
import { ProfilePhotoService } from './profile-photo.service';

describe('ProfilePhotoService', () => {
  const service = () => TestBed.inject(ProfilePhotoService);

  it('rejects a file that is not a photo', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    await expect(service().prepare(file)).rejects.toThrow('Choose a photo');
  });

  it('rejects a photo that is far too large', async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024)], 'huge.jpg', {
      type: 'image/jpeg',
    });

    await expect(service().prepare(file)).rejects.toThrow('too large');
  });
});
