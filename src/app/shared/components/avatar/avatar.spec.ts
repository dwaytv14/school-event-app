import { TestBed } from '@angular/core/testing';
import { AvatarComponent } from './avatar';

describe('AvatarComponent', () => {
  it('shows the picture when there is one', () => {
    const fixture = TestBed.createComponent(AvatarComponent);
    fixture.componentRef.setInput('src', 'data:image/jpeg;base64,AAAA');
    fixture.componentRef.setInput('name', 'Juan Dela Cruz');
    fixture.detectChanges();

    const image = fixture.nativeElement.querySelector('img');
    expect(image.getAttribute('alt')).toBe('Juan Dela Cruz profile picture');
  });

  it('falls back to the initials', () => {
    const fixture = TestBed.createComponent(AvatarComponent);
    fixture.componentRef.setInput('name', 'juan dela cruz');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('JD');
  });
});
