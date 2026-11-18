import { computed, signal } from '@angular/core';
import { canExcuseRow, excuseOpensOn } from '../../core/services/my-attendance.service';
import { ExcuseRequest } from '../../core/services/workspace-api.service';
import { EventsPart } from './events.part';

/** A student's attendance history and excuse requests. */
export abstract class StudentPart extends EventsPart {
  /** The signed-in student's attendance history and rate. */
  readonly attendanceSummary = computed(() =>
    this.myAttendance.summarize(
      this.state().events,
      this.state().attendance,
      this.activeStudent(),
    ),
  );
  /**
   * What a student can do about an excuse letter for the open event:
   * send one, wait for the answer, or nothing at all (for example they already attended).
   */
  readonly eventExcuse = computed(() => {
    this.schoolDay(); // opens by itself when the day before the event arrives
    const event = this.activeEvent();
    if (this.auth.role() !== 'student' || !event) return null;
    const [row] = this.myAttendance.summarize([event], this.state().attendance, this.activeStudent()).rows;
    if (!row) return null; // not this student's event
    const request = this.myExcuses().find(
      (item) => item.eventId === event.id && item.status !== 'approved',
    );
    const excused = row.status === 'Excused';
    const canSend = !excused && request?.status !== 'pending' && canExcuseRow(row);
    const tooEarly = !excused && !canSend && row.status === 'Upcoming' && request?.status !== 'pending';
    return {
      excused,
      request,
      canSend,
      /** Set while it is too early; the day letters open. */
      opensOn: tooEarly ? excuseOpensOn(event) : null,
    };
  });

  attendanceStatusColor(status: string): string {
    return status === 'Ongoing' || status === 'Upcoming'
      ? 'primary'
      : this.statusColor(status);
  }

  // ======================= Excuse requests =======================
  readonly myExcuses = signal<ExcuseRequest[]>([]);
  readonly excuseBusy = signal(false);
  readonly excuseError = signal<string | null>(null);
  excuseDraft: { eventId: string; reason: string; photo: string | null } = {
    eventId: '',
    reason: '',
    photo: null,
  };

  async loadMyExcuses(): Promise<void> {
    if (this.auth.role() !== 'student' || !this.isOnline()) return;
    try {
      this.myExcuses.set((await this.workspaceApi.myExcuses(this.auth.getToken())).excuses);
    } catch {
      // The list is a convenience; the page still works without it.
    }
  }

  excuseEventName(): string {
    return this.state().events.find((event) => event.id === this.excuseDraft.eventId)?.name ?? '';
  }

  startExcuse(eventId: string): void {
    this.excuseDraft = { eventId, reason: '', photo: null };
    this.excuseError.set(null);
    this.go('excuse-request');
  }

  async onExcusePhoto(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.excuseError.set(null);
    try {
      this.excuseDraft.photo = await this.profilePhoto.prepareDocument(file);
    } catch (error) {
      this.excuseError.set(error instanceof Error ? error.message : 'That photo could not be used.');
    }
  }

  async submitExcuse(): Promise<void> {
    const reason = this.excuseDraft.reason.trim();
    this.excuseError.set(null);
    if (reason.length < 10 || reason.length > 500) {
      this.excuseError.set('Explain the reason in 10 to 500 characters.');
      return;
    }
    if (!this.isOnline()) {
      this.excuseError.set('You need internet to send an excuse request.');
      return;
    }
    this.excuseBusy.set(true);
    try {
      await this.withLoading('Sending your request…', () =>
        this.workspaceApi.createExcuse(this.auth.getToken(), {
          eventId: this.excuseDraft.eventId,
          reason,
          photo: this.excuseDraft.photo,
        }),
      );
      this.showToast('Request sent. The admin will review it.');
      this.go('history');
    } catch (error) {
      this.excuseError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.excuseBusy.set(false);
    }
  }

  async withdrawExcuse(id: string): Promise<void> {
    try {
      await this.workspaceApi.withdrawExcuse(this.auth.getToken(), id);
      this.showToast('Request withdrawn.', 'warning');
      await this.loadMyExcuses();
    } catch (error) {
      this.showToast(this.workspaceApi.errorMessage(error), 'danger');
    }
  }
}
