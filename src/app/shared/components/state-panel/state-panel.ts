import { Component, input, output } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  calendarOutline,
  chatbubbleOutline,
  cloudOfflineOutline,
  peopleOutline,
  schoolOutline,
  searchOutline,
} from 'ionicons/icons';

/**
 * A dumb component for the "nothing here" and "something went wrong" states.
 * It says what happened in plain words and offers the next action.
 */
@Component({
  selector: 'app-state-panel',
  standalone: true,
  imports: [IonButton, IonIcon],
  templateUrl: './state-panel.html',
  styleUrl: './state-panel.scss',
})
export class StatePanelComponent {
  readonly tone = input<'empty' | 'error'>('empty');
  readonly icon = input('calendar-outline');
  readonly heading = input.required<string>();
  readonly message = input('');
  readonly actionLabel = input('');
  readonly action = output<void>();

  constructor() {
    addIcons({
      alertCircleOutline,
      calendarOutline,
      chatbubbleOutline,
      cloudOfflineOutline,
      peopleOutline,
      schoolOutline,
      searchOutline,
    });
  }
}
