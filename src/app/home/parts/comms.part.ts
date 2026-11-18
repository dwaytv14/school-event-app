import { clock12 } from '../../core/services/time-format';
import { computed } from '@angular/core';
import { isStudentRequired } from '../../core/services/event-roster';
import {
  Announcement,
  AnnouncementAudience,
  SmsMessage,
  Student,
} from '../../core/models/school-event.models';
import { CatalogPart } from './catalog.part';

/** Updates (announcements) and SMS messages. */
export abstract class CommsPart extends CatalogPart {

  /** Staff (admin and organizers) can post updates; students only read them. */
  readonly canPostUpdates = computed(() => this.auth.role() !== 'student');
  recipientMode: 'all' | 'section' | 'student' = 'all';
  recipientSection = 'Grade 10-A';
  recipientStudentId = 'STU-001';
  messageTemplate = 'Event reminder';
  messageText = '';
  async createAnnouncement(): Promise<void> {
    const title = this.announcementForm.title.trim();
    const body = this.announcementForm.body.trim();
    if (!title || !body) return;
    this.announcementError.set(null);
    let audience: AnnouncementAudience = { type: 'all' };
    if (this.announcementAudience === 'sections') {
      const selectedIds = this.selectedAnnouncementSectionIds();
      if (!selectedIds.length) {
        this.announcementError.set(
          'Add at least one course, year, or section group before publishing.',
        );
        return;
      }
      audience = { type: 'sections', sectionIds: selectedIds };
    }
    await this.publishAnnouncement(title, body, audience, () => {
      this.announcementForm = { title: '', body: '' };
      this.announcementAudience = 'all';
      this.announcementSectionIds = [];
      this.selectedAnnouncementSectionIds.set([]);
    });
  }

  /** Posts an update and texts the students it is for (used by Updates and cancel). */
  protected async publishAnnouncement(
    title: string,
    body: string,
    audience: AnnouncementAudience,
    afterSaved?: () => void,
  ): Promise<void> {
    this.store.update((state) => {
      state.announcements.unshift({
        id: `ANN-${Date.now()}`,
        title,
        body,
        createdAt: new Date().toISOString(),
        audience,
      });
    });
    // Text every targeted student on the number they registered with.
    const recipients = this.announcementRecipients(audience);
    const smsText = this.announcementSmsText(title, body);
    let smsFailed = false;
    let queued: SmsMessage[] = [];
    try {
      // Saved as "Queued"; they become "Sent" only once the phone really sends them.
      queued = await this.sms.sendMany(
        recipients,
        () => smsText,
        this.isOnline(),
        undefined,
        'Queued',
      );
    } catch (error) {
      smsFailed = true;
      this.sms.reportError(error);
    }
    afterSaved?.();
    try {
      await this.workspaceSync.syncNow();
      this.showToast(
        smsFailed
          ? 'Update published, but the text messages could not be prepared.'
          : 'Update published.',
        smsFailed ? 'warning' : 'success',
      );
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'The shared server could not be reached.';
      this.workspaceSync.error.set(
        `Announcement saved on this device but not published: ${detail}`,
      );
    }
    await this.textStudents(queued);
  }

  /** Asks once, then sends the update to every student from this phone's SIM. */
  protected async textStudents(messages: SmsMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const count = messages.length;
    const students = `${count} student${count === 1 ? '' : 's'}`;
    if (!this.nativeSms.available()) {
      this.showToast(
        `Saved ${count} text${count === 1 ? '' : 's'} in the SMS outbox. Sending works in the Android app.`,
        'warning',
      );
      return;
    }
    const confirmed = await this.confirm(
      `Text ${students}?`,
      `This sends ${count} SMS from your own SIM, using your load or unli-text promo. Keep the app open until it finishes.`,
      'Send texts',
    );
    if (!confirmed) {
      this.showToast('Texts saved in the SMS outbox. Send them anytime from there.', 'warning');
      return;
    }
    if (!(await this.nativeSms.ensurePermission())) {
      this.showToast('Allow SMS permission to send texts. They are saved in the outbox.', 'danger');
      return;
    }
    void this.bulkSms.run(messages);
  }

  readonly queuedTextCount = computed(
    () => this.sms.messages().filter((message) => message.status === 'Queued').length,
  );
  canSendTexts(): boolean {
    return this.nativeSms.available();
  }
  async sendQueuedTexts(): Promise<void> {
    const count = this.queuedTextCount();
    if (count === 0) return;
    const confirmed = await this.confirm(
      `Send ${count} queued text${count === 1 ? '' : 's'}?`,
      'They are sent from your own SIM, using your load or unli-text promo. Keep the app open until it finishes.',
      'Send texts',
    );
    if (!confirmed) return;
    if (!(await this.nativeSms.ensurePermission())) {
      this.showToast('Allow SMS permission to send texts.', 'danger');
      return;
    }
    void this.bulkSms.sendQueued();
  }
  /** Students an announcement audience reaches (those with a phone number). */
  protected announcementRecipients(audience: AnnouncementAudience): Student[] {
    return this.state().students.filter((student) => {
      if (!student.mobile) return false;
      if (audience.type === 'all') return true;
      if (audience.type === 'course') return student.course === audience.course;
      return !!student.sectionId && audience.sectionIds.includes(student.sectionId);
    });
  }
  protected announcementSmsText(title: string, body: string): string {
    const text = `GATHER update: ${title} - ${body}`.replace(/\s+/g, ' ');
    return text.length > 320 ? `${text.slice(0, 317)}...` : text;
  }
  announcementAudienceLabel(announcement: Announcement): string {
    const audience = announcement.audience;
    if (!audience || audience.type === 'all') return 'All students';
    if (audience.type === 'course') return `${audience.course} students`;
    const count = audience.sectionIds?.length ?? 0;
    return count ? `Selected audience · ${count} section${count === 1 ? '' : 's'}` : 'Selected sections';
  }
  smsUri(message: { recipientNumber: string; text: string }): string {
    return `sms:${message.recipientNumber}?body=${encodeURIComponent(message.text)}`;
  }

  chooseTemplate(template: string): void {
    this.messageTemplate = template;
    const event = this.activeEvent();
    const messages: Record<string, string> = {
      'Event reminder': `Reminder: ${event?.name} is on ${event ? this.formatDate(event.date) : ''} at ${clock12(event?.startTime)}. See you there!`,
      'Schedule change': `Schedule update for ${event?.name}: check event details for the latest time and venue.`,
      Cancellation: `${event?.name} has been cancelled. Please contact your organizer for more information.`,
      'Attendance confirmation': `Your attendance for ${event?.name} has been recorded.`,
    };
    this.messageText = messages[template] ?? '';
  }
  protected prepareCompose(): void {
    const event = this.activeEvent();
    if (!event) return;
    const labels = this.eventSectionLabels(event);
    if (!labels.includes(this.recipientSection)) {
      this.recipientSection = labels[0] ?? '';
    }
    const eligible = this.state().students.filter((student) =>
      isStudentRequired(event, student),
    );
    if (!eligible.some((student) => student.id === this.recipientStudentId)) {
      this.recipientStudentId = eligible[0]?.id ?? '';
    }
    if (!this.messageText.trim()) this.chooseTemplate(this.messageTemplate);
    this.sms.error.set(null);
  }
  async sendMessage(): Promise<void> {
    const activeEvent = this.activeEvent();
    const students = this.state().students.filter((student) =>
      !!activeEvent &&
      isStudentRequired(activeEvent, student) &&
      (this.recipientMode === 'section'
        ? student.section === this.recipientSection
        : this.recipientMode === 'student'
          ? student.id === this.recipientStudentId
          : true),
    );
    if (!this.messageText.trim()) return;
    if (students.length === 0) {
      this.sms.error.set(
        'No students match this recipient choice for the selected event. Choose another recipient.',
      );
      return;
    }
    try {
      await this.sms.sendMany(
        students,
        (student) => this.messageText.trim().replaceAll('{name}', student.name),
        this.isOnline(),
        this.activeEvent()?.id,
      );
      this.messageText = '';
      this.go('sms');
    } catch (error) {
      this.sms.reportError(error);
    }
  }
}
