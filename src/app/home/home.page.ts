import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonBadge,
  IonChip,
  IonDatetime,
  IonIcon,
  IonLabel,
  IonModal,
  IonProgressBar,
  IonSegment,
  IonSegmentButton,
  IonSkeletonText,
  IonTabBar,
  IonTabButton,
} from '@ionic/angular';
import { StatePanelComponent } from '../shared/components/state-panel/state-panel';
import { AvatarComponent } from '../shared/components/avatar/avatar';
import { AttendanceSummaryComponent } from '../shared/components/attendance-summary/attendance-summary';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  arrowBackOutline,
  calendarOutline,
  checkmarkCircleOutline,
  checkmarkDoneOutline,
  chevronForwardOutline,
  chatbubbleOutline,
  cloudOfflineOutline,
  closeOutline,
  createOutline,
  downloadOutline,
  gridOutline,
  homeOutline,
  locationOutline,
  logOutOutline,
  peopleOutline,
  personOutline,
  qrCodeOutline,
  scanOutline,
  schoolOutline,
  searchOutline,
  sendOutline,
  settingsOutline,
  shieldCheckmarkOutline,
  statsChartOutline,
  syncOutline,
  timeOutline,
  addOutline,
  cameraOutline,
  chevronBackOutline,
  eyeOutline,
  imageOutline,
} from 'ionicons/icons';
import { AuthPart } from './parts/auth.part';

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    FormsModule,
    RouterLink,
    IonBadge,
    IonChip,
    IonDatetime,
    IonIcon,
    IonLabel,
    IonModal,
    IonProgressBar,
    IonSegment,
    IonSegmentButton,
    IonSkeletonText,
    IonTabBar,
    IonTabButton,
    StatePanelComponent,
    AvatarComponent,
    AttendanceSummaryComponent,
  ],
})
export class HomePage extends AuthPart implements OnInit, OnDestroy {
  private lastScreen = '';
  private pendingScreen = '';
  private sessionChecked = false;
  private readonly screenScrollPositions = new Map<string, number>();
  private pullStartY?: number;

  constructor() {
    super();
    this.apiBaseUrl = this.workspaceApi.baseUrl();
    this.authUsername = this.auth.lastUsername();
    this.keepSignedIn = this.auth.rememberPreference();
    addIcons({
      alertCircleOutline,
      arrowBackOutline,
      calendarOutline,
      checkmarkCircleOutline,
      checkmarkDoneOutline,
      chevronForwardOutline,
      chatbubbleOutline,
      cloudOfflineOutline,
      closeOutline,
      createOutline,
      downloadOutline,
      gridOutline,
      homeOutline,
      locationOutline,
      logOutOutline,
      peopleOutline,
      personOutline,
      qrCodeOutline,
      scanOutline,
      schoolOutline,
      searchOutline,
      sendOutline,
      settingsOutline,
      shieldCheckmarkOutline,
      statsChartOutline,
      syncOutline,
      timeOutline,
      addOutline,
      cameraOutline,
      chevronBackOutline,
      eyeOutline,
      imageOutline,
    });
    this.route.paramMap.subscribe((params) => {
      this.handleScreen(params.get('screen') ?? 'login');
    });
  }

  private handleScreen(screen: string): void {
    {
      const role = this.auth.role();
      if (!role && screen !== 'login') {
        if (this.auth.hasSavedSession() && !this.sessionChecked) {
          // A saved session is still being verified; remember where to return.
          this.pendingScreen = screen;
          this.page.set(screen);
          return;
        }
        this.page.set('login');
        void this.router.navigate(['/login']);
        return;
      }
      if (this.lastScreen && this.lastScreen !== screen) {
        this.screenScrollPositions.set(this.lastScreen, window.scrollY);
      }
      if (role && !this.allowedScreens(role).includes(screen)) {
        this.page.set(this.homeScreenForRole());
        void this.router.navigate(['/workspace', this.homeScreenForRole()]);
        return;
      }
      this.page.set(screen);
      this.lastScreen = screen;
      if (screen === 'edit-event' && !this.editingEventId()) {
        this.loadEventForEditing();
      }
      requestAnimationFrame(() => {
        try {
          window.scrollTo({
            top: this.screenScrollPositions.get(screen) ?? 0,
            behavior: 'instant',
          });
        } catch {
          // Scrolling is cosmetic; ignore environments that cannot scroll.
        }
      });
      if (
        ['settings-accounts', 'settings-account-create', 'settings-account-reset'].includes(screen) &&
        this.auth.role() === 'super_admin'
      ) {
        void this.loadManagedAccounts();
      }
      if (screen === 'settings-sections' && this.auth.role() === 'super_admin') {
        void this.loadSections();
      }
      if (screen === 'seating' && this.auth.role() === 'super_admin') {
        void this.loadSections();
      }
      if (screen === 'settings-account-reset' && this.auth.role() === 'super_admin') {
        void this.loadSections();
      }
      if (screen === 'announcements' && this.auth.role() !== 'student') {
        void this.loadSections();
      }
      if (['create-event', 'edit-event'].includes(screen) && this.auth.role()) {
        void this.loadSections();
      }
      if (screen === 'compose-sms') this.prepareCompose();
      if (role === 'student' && screen === 'history') void this.loadMyExcuses();
      if (role === 'super_admin') {
        if (screen === 'home' || screen === 'excuses') void this.loadExcuses();
        if (screen === 'settings-activity') void this.loadAudit(true);
        if (screen === 'settings-school-year') void this.loadSchoolYear();
        if (screen === 'settings-organizers' || screen === 'student-detail') {
          void this.loadManagedAccounts();
        }
      }
      if (this.page() === 'my-qr') void this.refreshQr();
    }
  }

  ngOnInit(): void {
    void this.initializePage();
  }
  ngOnDestroy(): void {
    this.stopScanner();
  }
  capturePullStart(event: TouchEvent): void {
    const listScreen = ['events', 'announcements', 'students'].includes(this.page());
    this.pullStartY =
      listScreen && window.scrollY <= 0 ? event.touches[0]?.clientY : undefined;
  }

  completePullRefresh(event: TouchEvent): void {
    const startY = this.pullStartY;
    this.pullStartY = undefined;
    const endY = event.changedTouches[0]?.clientY;
    if (startY !== undefined && endY !== undefined && endY - startY >= 72) {
      void this.refreshNow();
    }
  }

  private async initializePage(): Promise<void> {
    await this.workspaceSync.initialize();
    this.sessionChecked = true;
    if (this.auth.authenticated()) {
      this.store.update((state) => {
        state.role = this.auth.role();
        state.studentId = this.auth.studentId() ?? '';
      });
      const target = this.pendingScreen;
      this.pendingScreen = '';
      if (this.page() === 'login') {
        void this.router.navigate(['/workspace/home']);
      } else if (target) {
        this.handleScreen(target);
      }
      void this.refreshQr();
    } else if (this.page() !== 'login') {
      this.pendingScreen = '';
      this.page.set('login');
      void this.router.navigate(['/login']);
    }
  }
}
