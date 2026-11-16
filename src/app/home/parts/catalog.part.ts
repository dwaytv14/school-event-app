import { signal } from '@angular/core';
import { SchoolSection } from '../../core/services/workspace-api.service';
import { EventSeatingPlan, SchoolEvent, SeatBlock } from '../../core/models/school-event.models';
import { HomeBaseDirective } from './home-base.directive';
import { emptySeatingPlan } from '../home.types';

/** Sections, the event form and seat layout editor, and the audience pickers. */
export abstract class CatalogPart extends HomeBaseDirective {
  readonly selectedEventRequiredSections = signal<string[]>([]);
  readonly sectionError = signal<string | null>(null);
  readonly sectionsLoading = signal(false);
  readonly eventError = signal<string | null>(null);
  readonly eventDatePickerOpen = signal(false);
  signupSectionGroup = { course: 'BSIT', yearLevel: '', sectionIds: [] as string[] };
  sectionForm = { course: 'BSIT', yearLevel: '1st Year', name: '' };
  editingSectionId = '';
  announcementForm = { title: '', body: '' };
  announcementAudience: 'all' | 'sections' = 'all';
  announcementCourse = 'BSIT';
  announcementYearLevel = '';
  announcementSectionIds: string[] = [];
  readonly selectedAnnouncementSectionIds = signal<string[]>([]);
  readonly announcementError = signal<string | null>(null);
  eventForm = {
    name: '',
    date: '',
    startTime: '08:00',
    endTime: '16:00',
    venue: 'Gymnasium',
    description: '',
    graceMinutes: 15,
    requiredSections: [] as string[],
  };
  eventSeatingPlan = emptySeatingPlan();
  get minimumEventDate(): string {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${today.getFullYear()}-${month}-${day}`;
  }
  readonly editingEventId = signal<string | null>(null);
  eventGroupYears(): string[] {
    const years = [...new Set(
      this.schoolSections()
        .filter((section) => section.course === this.signupSectionGroup.course)
        .map((section) => section.yearLevel),
    )].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right),
    );
    return years.length ? ['All years', ...years] : [];
  }
  availableCourses(): string[] {
    const sectionCourses = [
      ...new Set(this.schoolSections().map((section) => section.course)),
    ].sort();
    return sectionCourses.length ? sectionCourses : this.courses;
  }
  eventGroupSections(): SchoolSection[] {
    return this.schoolSections().filter(
      (section) =>
        section.course === this.signupSectionGroup.course &&
        (this.signupSectionGroup.yearLevel === 'All years' ||
          section.yearLevel === this.signupSectionGroup.yearLevel),
    );
  }
  eventGroupCourseChanged(): void {
    this.signupSectionGroup.yearLevel = this.eventGroupYears()[0] ?? '';
    this.signupSectionGroup.sectionIds = [];
    this.syncEventGroupSections();
  }
  eventGroupYearChanged(): void {
    this.signupSectionGroup.sectionIds = [];
    this.syncEventGroupSections();
  }
  protected syncEventGroupSections(): void {
    const options = this.eventGroupSections();
    if (options.length === 1) {
      this.signupSectionGroup.sectionIds = [options[0].id];
    } else {
      this.signupSectionGroup.sectionIds =
        this.signupSectionGroup.sectionIds.filter((id) =>
          options.some((section) => section.id === id),
        );
    }
  }
  toggleEventGroupSection(sectionId: string, selected: boolean): void {
    const current = new Set(this.signupSectionGroup.sectionIds);
    if (selected) current.add(sectionId);
    else current.delete(sectionId);
    this.signupSectionGroup.sectionIds = [...current];
  }
  setEventGroupSection(event: Event, sectionId: string): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.toggleEventGroupSection(sectionId, event.target.checked);
  }
  selectAllEventGroupSections(): void {
    this.signupSectionGroup.sectionIds = this.eventGroupSections().map(
      (section) => section.id,
    );
  }
  addEventSectionGroup(): void {
    const sections = this.eventGroupSections();
    const selected = this.signupSectionGroup.sectionIds;
    if (!selected.length) return;
    const validIds = new Set(sections.map((section) => section.id));
    const next = new Set(this.selectedEventRequiredSections());
    selected.forEach((id) => {
      if (validIds.has(id)) next.add(id);
    });
    this.selectedEventRequiredSections.set([...next]);
    this.signupSectionGroup.sectionIds = [];
  }
  requiredSectionLabel(id: string): string {
    const section = this.schoolSections().find((item) => item.id === id);
    return section
      ? `${section.course} ${section.yearLevel} ${section.name}`
      : id;
  }
  removeRequiredSection(id: string): void {
    this.selectedEventRequiredSections.update((sections) =>
      sections.filter((sectionId) => sectionId !== id),
    );
    this.eventSeatingPlan.gymnasiumBenchGroups =
      this.eventSeatingPlan.gymnasiumBenchGroups.map((group) =>
        group.sectionId === id ? { ...group, sectionId: null } : group,
      );
    this.eventSeatingPlan.sharedSectionIds =
      (this.eventSeatingPlan.sharedSectionIds ?? []).filter(
        (sectionId) => sectionId !== id,
      );
    delete this.eventSeatingPlan.sectionSeatCounts[id];
  }
  eventSectionChoices(): SchoolSection[] {
    const selected = new Set(this.selectedEventRequiredSections());
    return this.schoolSections().filter((section) => selected.has(section.id));
  }
  eventSectionChoicesForEvent(event: SchoolEvent): SchoolSection[] {
    const required = new Set(event.requiredSections ?? []);
    return this.schoolSections().filter((section) => required.has(section.id));
  }
  eventSectionLabels(event: SchoolEvent): string[] {
    if (event.roster) {
      return Object.entries(event.roster)
        .filter(([, ids]) => ids.length > 0)
        .map(([label]) => label)
        .sort();
    }
    const required = event.requiredSections ?? [];
    if (!required.length) return event.sections;
    const labels = new Set<string>();
    required.forEach((id) => {
      const members = this.state().students.filter(
        (student) => student.sectionId === id,
      );
      if (members.length) {
        members.forEach((student) => labels.add(student.section));
      } else {
        const section = this.schoolSections().find((item) => item.id === id);
        if (section) labels.add(this.sectionLabel(section));
      }
    });
    return labels.size ? [...labels] : event.sections;
  }
  sectionLabel(section: SchoolSection): string {
    return `${section.course} ${section.yearLevel} ${section.name}`;
  }
  protected blocks(): SeatBlock[] {
    const plan = this.eventSeatingPlan;
    plan.blocks ??= [{ rows: plan.rows ?? 0, seatsPerRow: plan.seatsPerRow ?? 10 }];
    return plan.blocks;
  }
  previewCols(): number {
    return this.seatBlocks()
      .filter((block) => block.rows > 0)
      .reduce((total, block) => total + block.seatsPerRow, 0);
  }
  previewBlockCount(): number {
    return Math.max(1, this.seatBlocks().filter((block) => block.rows > 0).length);
  }
  eventCols(event: SchoolEvent): number {
    const blocks = event.seatingPlan?.blocks?.filter((block) => block.rows > 0);
    if (blocks?.length) {
      return blocks.reduce((total, block) => total + block.seatsPerRow, 0);
    }
    return event.seatingPlan?.seatsPerRow || 10;
  }
  seatBlocks(): SeatBlock[] {
    return this.blocks();
  }
  protected recalcSeatTotal(): void {
    const blocks = this.blocks();
    this.eventSeatingPlan.sharedSeatCount = blocks.reduce(
      (total, block) => total + block.rows * block.seatsPerRow,
      0,
    );
    this.eventSeatingPlan.rows = blocks[0]?.rows ?? 0;
    this.eventSeatingPlan.seatsPerRow = blocks[0]?.seatsPerRow ?? 10;
  }
  stepBlockRows(index: number, delta: number): void {
    const block = this.blocks()[index];
    if (!block) return;
    block.rows = Math.min(50, Math.max(0, block.rows + delta));
    this.recalcSeatTotal();
  }
  stepBlockSeats(index: number, delta: number): void {
    const block = this.blocks()[index];
    if (!block) return;
    block.seatsPerRow = Math.min(50, Math.max(1, block.seatsPerRow + delta));
    this.recalcSeatTotal();
  }
  addSeatBlock(): void {
    if (this.blocks().length >= 2) return;
    this.blocks().push({ rows: 10, seatsPerRow: 10 });
    this.recalcSeatTotal();
  }
  removeSeatBlock(index: number): void {
    if (this.blocks().length <= 1) return;
    const [removed] = this.blocks().splice(index, 1);
    this.recalcSeatTotal();
    this.showToast(`Line ${index + 1} removed`, 'warning', () => {
      this.blocks().splice(index, 0, removed);
      this.recalcSeatTotal();
    });
  }
  isRequiredSelected(id: string): boolean {
    return this.selectedEventRequiredSections().includes(id);
  }
  toggleRequiredSection(id: string): void {
    if (this.isRequiredSelected(id)) this.removeRequiredSection(id);
    else this.selectedEventRequiredSections.update((ids) => [...ids, id]);
  }
  allGroupSectionsSelected(): boolean {
    const sections = this.eventGroupSections();
    return sections.length > 0 && sections.every((s) => this.isRequiredSelected(s.id));
  }
  toggleAllGroupSections(): void {
    const sections = this.eventGroupSections();
    if (this.allGroupSectionsSelected()) {
      sections.forEach((s) => this.removeRequiredSection(s.id));
    } else {
      this.selectedEventRequiredSections.update((ids) => [
        ...ids,
        ...sections.map((s) => s.id).filter((id) => !ids.includes(id)),
      ]);
    }
  }
  updateSeatLayout(rows: number | null, seatsPerRow: number | null): void {
    const rowCount = Math.max(0, Math.floor(Number(rows) || 0));
    const perRow = Math.max(0, Math.floor(Number(seatsPerRow) || 0));
    this.eventSeatingPlan.rows = rowCount;
    this.eventSeatingPlan.seatsPerRow = perRow;
    this.eventSeatingPlan.sharedSeatCount = rowCount * perRow;
  }
  range(count: number): number[] {
    return Array.from({ length: Math.max(0, Math.min(50, count || 0)) }, (_, i) => i);
  }
  async loadSections(): Promise<void> {
    this.sectionsLoading.set(true);
    this.sectionError.set(null);
    try {
      const { sections } = await this.workspaceApi.listSections(
        this.auth.getToken() || undefined,
      );
      this.schoolSections.set(sections);
      this.hydrateEventSeatingPlan();
      if (!this.availableCourses().includes(this.announcementCourse)) {
        this.announcementCourse = this.availableCourses()[0] ?? this.courses[0];
      }
      if (
        !this.announcementYears().includes(this.announcementYearLevel)
      ) {
        this.announcementYearLevel = this.announcementYears()[0] ?? '';
      }
      this.announcementYearChanged();
      if (!this.eventGroupYears().length) {
        this.signupSectionGroup.course =
          this.availableCourses().find((course) =>
            this.schoolSections().some((section) => section.course === course),
          ) ?? this.availableCourses()[0];
      }
      if (this.signupSectionGroup.course && this.eventGroupYears().length) {
        if (!this.eventGroupYears().includes(this.signupSectionGroup.yearLevel)) {
          this.signupSectionGroup.yearLevel = this.eventGroupYears()[0];
        }
        this.syncEventGroupSections();
      } else {
        this.signupSectionGroup.yearLevel = '';
        this.signupSectionGroup.sectionIds = [];
      }
    } catch (error) {
      this.sectionError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.sectionsLoading.set(false);
    }
  }
  protected hydrateEventSeatingPlan(): void {
    const eventId = this.editingEventId();
    const event = this.state().events.find((item) => item.id === eventId);
    if (!event || event.seatingPlan) return;

    this.eventSeatingPlan = {
      ...emptySeatingPlan(),
      sharedSeatCount: event.seats.length,
      rows: Math.ceil(event.seats.length / 10),
      seatsPerRow: 10,
      blocks: [{ rows: Math.ceil(event.seats.length / 10), seatsPerRow: 10 }],
      sharedSectionIds: event.requiredSections ?? [],
    };
  }
  sectionGroups(): {
    course: string;
    count: number;
    open: boolean;
    years: { yearLevel: string; sections: SchoolSection[] }[];
  }[] {
    const editing = this.schoolSections().find(
      (section) => section.id === this.editingSectionId,
    );
    const courses = [
      ...new Set(this.schoolSections().map((section) => section.course)),
    ].sort();
    return courses.map((course) => {
      const inCourse = this.schoolSections().filter(
        (section) => section.course === course,
      );
      const years = [...new Set(inCourse.map((section) => section.yearLevel))].sort(
        (a, b) => this.yearLevels.indexOf(a) - this.yearLevels.indexOf(b),
      );
      return {
        course,
        count: inCourse.length,
        open: editing?.course === course,
        years: years.map((yearLevel) => ({
          yearLevel,
          sections: inCourse
            .filter((section) => section.yearLevel === yearLevel)
            .sort((a, b) => a.name.localeCompare(b.name)),
        })),
      };
    });
  }
  editSection(section: SchoolSection): void {
    this.editingSectionId = section.id;
    this.sectionForm = {
      course: section.course,
      yearLevel: section.yearLevel,
      name: section.name,
    };
    // Bring the edit form into view and focus it, so the tap visibly does something.
    setTimeout(() => {
      const form = document.getElementById('section-form');
      const reduceMotion =
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;
      form?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      document.getElementById('section-name-input')?.focus({ preventScroll: true });
    }, 50);
  }
  cancelSectionEdit(): void {
    this.editingSectionId = '';
    this.sectionForm = { course: 'BSIT', yearLevel: '1st Year', name: '' };
  }
  async saveSection(): Promise<void> {
    this.sectionError.set(null);
    try {
      if (this.editingSectionId) {
        await this.workspaceApi.updateSection(
          this.auth.getToken(),
          this.editingSectionId,
          this.sectionForm,
        );
      } else {
        await this.workspaceApi.createSection(
          this.auth.getToken(),
          this.sectionForm,
        );
      }
      this.editingSectionId = '';
      this.sectionForm = { course: 'BSIT', yearLevel: '1st Year', name: '' };
      await this.loadSections();
      this.showToast('Section saved.');
    } catch (error) {
      this.sectionError.set(this.workspaceApi.errorMessage(error));
    }
  }
  announcementYears(): string[] {
    const years = [...new Set(
      this.schoolSections()
        .filter((section) => section.course === this.announcementCourse)
        .map((section) => section.yearLevel),
    )].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right),
    );
    return years.length ? ['All years', ...years] : [];
  }
  announcementSections(): SchoolSection[] {
    return this.schoolSections().filter(
      (section) =>
        section.course === this.announcementCourse &&
        (this.announcementYearLevel === 'All years' ||
          section.yearLevel === this.announcementYearLevel),
    );
  }
  announcementCourseChanged(): void {
    this.announcementYearLevel = this.announcementYears()[0] ?? '';
    this.announcementSectionIds = [];
  }
  announcementYearChanged(): void {
    const availableIds = new Set(
      this.announcementSections().map((section) => section.id),
    );
    this.announcementSectionIds = this.announcementSectionIds.filter((id) =>
      availableIds.has(id),
    );
  }
  setAnnouncementSection(event: Event, sectionId: string): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const selectedIds = new Set(this.announcementSectionIds);
    if (event.target.checked) selectedIds.add(sectionId);
    else selectedIds.delete(sectionId);
    this.announcementSectionIds = [...selectedIds];
  }
  selectAllAnnouncementSections(): void {
    this.announcementSectionIds = this.announcementSections().map(
      (section) => section.id,
    );
  }
  addAnnouncementSectionGroup(): void {
    const availableIds = new Set(
      this.announcementSections().map((section) => section.id),
    );
    const next = new Set(this.selectedAnnouncementSectionIds());
    this.announcementSectionIds.forEach((id) => {
      if (availableIds.has(id)) next.add(id);
    });
    if (next.size === this.selectedAnnouncementSectionIds().length) {
      this.announcementError.set('Select at least one section for this audience group.');
      return;
    }
    this.selectedAnnouncementSectionIds.set([...next]);
    this.announcementSectionIds = [];
    this.announcementError.set(null);
  }
  removeAnnouncementSection(sectionId: string): void {
    this.selectedAnnouncementSectionIds.update((ids) =>
      ids.filter((id) => id !== sectionId),
    );
  }
  createEvent(): void {
    this.editingEventId.set(null);
    this.eventSeatingPlan = emptySeatingPlan();
    this.eventForm = {
      name: '',
      date: '',
      startTime: '08:00',
      endTime: '16:00',
      venue: '',
      description: '',
      graceMinutes: 15,
      requiredSections: [],
    };
    this.selectedEventRequiredSections.set([]);
    this.eventError.set(null);
    this.signupSectionGroup.course = this.courses[0];
    this.signupSectionGroup.yearLevel = '';
    this.signupSectionGroup.sectionIds = [];
    this.go('create-event');
  }
  editEvent(): void {
    if (!this.loadEventForEditing()) return;
    this.go('edit-event');
  }
  protected loadEventForEditing(): boolean {
    const event = this.activeEvent();
    if (!event) {
      this.eventError.set('No event is available to edit.');
      return false;
    }
    this.editingEventId.set(event.id);
    this.eventError.set(null);
    this.eventForm = {
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      venue:
        event.venue === 'Conference room' ? 'Conference room' : 'Gymnasium',
      description: event.description,
      graceMinutes: event.graceMinutes,
      requiredSections: event.requiredSections ?? [],
    };
    this.selectedEventRequiredSections.set(event.requiredSections ?? []);
    this.eventSeatingPlan = event.seatingPlan
      ? structuredClone(event.seatingPlan)
      : emptySeatingPlan();
    if (event.seatingPlan) {
      const seatingPlan = this.eventSeatingPlan;
      if (seatingPlan.sharedSeatCount === undefined) {
        const legacyCounts = seatingPlan.sectionSeatCounts ?? {};
        seatingPlan.sharedSeatCount = Object.values(legacyCounts).reduce(
          (total, count) => total + count,
          0,
        );
        seatingPlan.sharedSectionIds = Object.entries(legacyCounts)
          .filter(([, count]) => count > 0)
          .map(([sectionId]) => sectionId);
      }
      seatingPlan.sharedSectionIds ??= [];
      seatingPlan.sectionSeatCounts ??= {};
      if (!seatingPlan.seatsPerRow) {
        seatingPlan.seatsPerRow = 10;
      }
      if (!seatingPlan.blocks?.length) {
        const perRow = seatingPlan.seatsPerRow ?? 10;
        const rows = Math.ceil((seatingPlan.sharedSeatCount ?? 0) / perRow);
        seatingPlan.blocks = [{ rows, seatsPerRow: perRow }];
      }
      if (seatingPlan.rows === undefined) {
        seatingPlan.rows = Math.ceil(
          (seatingPlan.sharedSeatCount ?? 0) / seatingPlan.seatsPerRow,
        );
        seatingPlan.sharedSeatCount = seatingPlan.rows * seatingPlan.seatsPerRow;
      }
    }
    return true;
  }
  saveEvent(): void {
    const editingEventId =
      this.page() === 'edit-event' ? this.editingEventId() : null;
    if (this.page() === 'edit-event' && !editingEventId) {
      this.eventError.set('The event could not be found. Return to Events and try again.');
      return;
    }
    if (
      editingEventId &&
      !this.state().events.some((event) => event.id === editingEventId)
    ) {
      this.eventError.set('The event no longer exists. Return to Events and try again.');
      return;
    }
    const previousDate = editingEventId
      ? this.state().events.find((event) => event.id === editingEventId)
          ?.date
      : undefined;
    if (
      !this.eventForm.date ||
      (this.eventForm.date < this.minimumEventDate &&
        this.eventForm.date !== previousDate)
    ) {
      this.eventError.set(
        this.eventForm.date
          ? 'Choose today or a future date.'
          : 'Choose an event date.',
      );
      return;
    }
    const graceMinutes = Number(this.eventForm.graceMinutes);
    if (
      !Number.isInteger(graceMinutes) ||
      graceMinutes < 0 ||
      graceMinutes > 120
    ) {
      this.eventError.set(
        'Grace period must be a whole number from 0 to 120 minutes.',
      );
      return;
    }
    if (this.selectedEventRequiredSections().length === 0) {
      this.eventError.set('Select at least one required section group.');
      return;
    }
    const selectedSectionLabels = this.selectedEventRequiredSections().flatMap(
      (id) => {
        const section = this.schoolSections().find((item) => item.id === id);
        return section
          ? [`${section.course} ${section.yearLevel} ${section.name}`]
          : [];
      },
    );
    if (selectedSectionLabels.length !== this.selectedEventRequiredSections().length) {
      this.eventError.set('Wait for the section list to load, then try again.');
      return;
    }
    const sharedSectionIds = [...this.selectedEventRequiredSections()];
    const seatBlocks = this.seatBlocks().map((block) => ({
      rows: Number(block.rows),
      seatsPerRow: Number(block.seatsPerRow),
    }));
    const seatingPlan: EventSeatingPlan = {
      gymnasiumBenchGroups: [],
      blocks: seatBlocks.filter((block) => block.rows > 0),
      sharedSeatCount: seatBlocks.reduce(
        (total, block) => total + block.rows * block.seatsPerRow,
        0,
      ),
      rows: this.eventSeatingPlan.rows ?? 0,
      seatsPerRow: this.eventSeatingPlan.seatsPerRow ?? 10,
      sharedSectionIds,
      sectionSeatCounts: {},
    };
    const sharedSeatCount = seatingPlan.sharedSeatCount ?? 0;
    if (
      seatBlocks.some(
        (block) =>
          !Number.isInteger(block.rows) ||
          !Number.isInteger(block.seatsPerRow) ||
          block.rows < 0 ||
          block.rows > 50 ||
          block.seatsPerRow < 1 ||
          block.seatsPerRow > 50,
      )
    ) {
      this.eventError.set('Rows and chairs per row must be whole numbers from 0 to 50.');
      return;
    }
    if (sharedSeatCount > 500) {
      this.eventError.set('The total number of chairs cannot be more than 500.');
      return;
    }
    if (sharedSeatCount === 0) {
      this.eventError.set('Add at least one row of chairs for the attendees.');
      return;
    }
    this.eventError.set(null);
    const saved = this.events.save(
      {
        ...this.eventForm,
        graceMinutes,
        requiredSections: this.selectedEventRequiredSections(),
        seatingPlan,
      },
      editingEventId ?? undefined,
      selectedSectionLabels.map((label, index) => ({
        id: this.selectedEventRequiredSections()[index],
        label,
      })),
    );
    this.selectEvent(saved.id);
    this.showToast(editingEventId ? 'Event updated.' : 'Event created.');
    this.editingEventId.set(null);
    this.go('event-details');
  }

  setEventDate(value: string | string[] | null | undefined): void {
    if (typeof value !== 'string') return;
    const date = value.slice(0, 10);
    if (date < this.minimumEventDate) {
      this.eventError.set('Choose today or a future date.');
      return;
    }
    this.eventForm.date = date;
    this.eventError.set(null);
    this.eventDatePickerOpen.set(false);
  }
}
