import { TestBed } from '@angular/core/testing';
import { StatePanelComponent } from './state-panel';

describe('StatePanelComponent', () => {
  it('shows the heading and emits the action', () => {
    const fixture = TestBed.createComponent(StatePanelComponent);
    fixture.componentRef.setInput('heading', 'No events yet');
    fixture.componentRef.setInput('actionLabel', 'Create event');
    fixture.detectChanges();
    let clicked = 0;
    fixture.componentInstance.action.subscribe(() => (clicked += 1));

    expect(fixture.nativeElement.textContent).toContain('No events yet');
    expect(fixture.nativeElement.textContent).toContain('Create event');
    fixture.nativeElement.querySelector('ion-button').click();
    expect(clicked).toBe(1);
  });

  it('announces errors as alerts', () => {
    const fixture = TestBed.createComponent(StatePanelComponent);
    fixture.componentRef.setInput('heading', 'Oops');
    fixture.componentRef.setInput('tone', 'error');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });
});
