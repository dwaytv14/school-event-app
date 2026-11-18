import { computed, signal } from '@angular/core';
import { SchoolSection } from '../../core/services/workspace-api.service';
import { SchoolEvent } from '../../core/models/school-event.models';
import { schoolDateKey } from '../../core/services/time-format';
import { HomeBaseDirective } from './home-base.directive';

interface EventSectionScope {
  key: string;
  label: string;
  sectionIds: string[];
}

/** One tag in the "Who is attending?" box: a whole group, or a single section. */
export interface EventSectionChip {
  key: string;
  label: string;
  title: string;
  sectionIds: string[];
}

/** Sections, event setup, and audience pickers. */
export abstract class CatalogPart extends HomeBaseDirective {
  readonly selectedEventRequiredSections = signal<string[]>([]);
  readonly sectionError = signal<string | null>(null);
  readonly sectionsLoading = signal(false);
  readonly eventSectionPickerOpen = signal(false);
  eventSectionSearch = '';
  readonly eventError = signal<string | null>(null);
  readonly eventDatePickerOpen = signal(false);
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
  get minimumEventDate(): string {
    return schoolDateKey();
  }
  readonly editingEventId = signal<string | null>(null);
  availableCourses(): string[] {
    const sectionCourses = [
      ...new Set(this.schoolSections().map((section) => section.course)),
    ].sort();
    return sectionCourses.length ? sectionCourses : this.courses;
  }
  readonly eventSectionScopes = computed<EventSectionScope[]>(() => {
    const sections = this.schoolSections();
    const courses = [...new Set(sections.map((section) => section.course))].sort();
    const years = [...new Set(sections.map((section) => section.yearLevel))].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right) ||
        left.localeCompare(right),
    );
    const scope = (key: string, label: string, matching: SchoolSection[]) => ({
      key,
      label,
      sectionIds: matching.map((section) => section.id),
    });
    return [
      scope('all', 'All Years & Levels', sections),
      ...courses.map((course) =>
        scope(
          `course:${course}`,
          `All ${course}`,
          sections.filter((section) => section.course === course),
        ),
      ),
      ...years.map((year) =>
        scope(
          `year:${year}`,
          `All ${year}`,
          sections.filter((section) => section.yearLevel === year),
        ),
      ),
      ...courses.flatMap((course) =>
        years
          .filter((year) =>
            sections.some(
              (section) => section.course === course && section.yearLevel === year,
            ),
          )
          .map((year) =>
            scope(
              `course-year:${course}:${year}`,
              `All ${course} ${year}`,
              sections.filter(
                (section) =>
                  section.course === course && section.yearLevel === year,
              ),
            ),
          ),
      ),
    ];
  });
  filteredEventSectionScopes(): EventSectionScope[] {
    const query = this.eventSectionSearch.trim().toLowerCase();
    return this.eventSectionScopes().filter(
      (scope) => !query || scope.label.toLowerCase().includes(query),
    );
  }
  filteredEventSections(): SchoolSection[] {
    const query = this.eventSectionSearch.trim().toLowerCase();
    return this.schoolSections().filter(
      (section) =>
        !query || this.sectionLabel(section).toLowerCase().includes(query),
    );
  }
  updateEventSectionSearch(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.eventSectionSearch = event.target.value;
    }
  }
  toggleEventSectionPicker(): void {
    this.eventSectionPickerOpen.update((open) => !open);
  }
  closeEventSectionPicker(): void {
    this.eventSectionPickerOpen.set(false);
    this.eventSectionSearch = '';
  }
  closeEventSectionPickerOnBlur(event: FocusEvent): void {
    const container = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (
      container instanceof HTMLElement &&
      (!(nextTarget instanceof Node) || !container.contains(nextTarget))
    ) {
      this.closeEventSectionPicker();
    }
  }
  private resetEventSectionPicker(): void {
    this.closeEventSectionPicker();
  }
  requiredSectionLabel(id: string): string {
    const section = this.schoolSections().find((item) => item.id === id);
    return section
      ? `${section.course} ${section.yearLevel} ${section.name}`
      : id;
  }
  removeRequiredSection(id: string): void {
    this.removeRequiredSections([id]);
  }
  private removeRequiredSections(sectionIds: string[]): void {
    const removed = new Set(sectionIds);
    this.selectedEventRequiredSections.update((sections) =>
      sections.filter((sectionId) => !removed.has(sectionId)),
    );
  }
  /**
   * What the box shows for the chosen sections. When a whole group is chosen
   * ("All Years & Levels", "All BSIT", "All BSIT 4th Year"…) it shows that one group,
   * not every section in it. Sections not covered by a group show one by one.
   */
  readonly eventSectionChips = computed<EventSectionChip[]>(() => {
    const selected = new Set(this.selectedEventRequiredSections());
    const covered = new Set<string>();
    const chips: EventSectionChip[] = [];
    const wholeGroups = this.eventSectionScopes()
      .filter(
        (scope) =>
          scope.sectionIds.length > 1 && scope.sectionIds.every((id) => selected.has(id)),
      )
      // The biggest group first, so "All Years & Levels" replaces everything inside it.
      .sort((left, right) => right.sectionIds.length - left.sectionIds.length);
    for (const scope of wholeGroups) {
      // A group is worth a tag only if it adds at least two sections not already shown;
      // otherwise the one leftover section is clearer on its own.
      const added = scope.sectionIds.filter((id) => !covered.has(id));
      if (added.length < 2) continue;
      scope.sectionIds.forEach((id) => covered.add(id));
      chips.push({
        key: scope.key,
        label: scope.label,
        title: `${scope.sectionIds.length} sections`,
        sectionIds: scope.sectionIds,
      });
    }
    for (const section of this.schoolSections()) {
      if (selected.has(section.id) && !covered.has(section.id)) {
        chips.push({
          key: section.id,
          label: this.sectionLabel(section),
          title: this.sectionLabel(section),
          sectionIds: [section.id],
        });
      }
    }
    return chips;
  });
  /** Removing a group's tag removes every section in that group. */
  removeEventSectionChip(chip: EventSectionChip): void {
    this.removeRequiredSections(chip.sectionIds);
  }
  eventSectionChoices(): SchoolSection[] {
    const selected = new Set(this.selectedEventRequiredSections());
    return this.schoolSections().filter((section) => selected.has(section.id));
  }
  selectedEventAttendeeCount(): number {
    const sectionIds = new Set(this.selectedEventRequiredSections());
    const sectionLabels = new Set(
      this.eventSectionChoices().map((section) => this.sectionLabel(section)),
    );
    return this.state().students.filter(
      (student) =>
        sectionIds.has(student.sectionId ?? '') ||
        sectionLabels.has(student.section),
    ).length;
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
  isRequiredSelected(id: string): boolean {
    return this.selectedEventRequiredSections().includes(id);
  }
  isEventSectionScopeSelected(scope: EventSectionScope): boolean {
    return (
      scope.sectionIds.length > 0 &&
      scope.sectionIds.every((id) => this.isRequiredSelected(id))
    );
  }
  toggleEventSectionScope(scope: EventSectionScope): void {
    if (this.isEventSectionScopeSelected(scope)) {
      this.removeRequiredSections(scope.sectionIds);
      return;
    }
    this.selectedEventRequiredSections.update((ids) => [
      ...new Set([...ids, ...scope.sectionIds]),
    ]);
  }
  toggleRequiredSection(id: string): void {
    if (this.isRequiredSelected(id)) this.removeRequiredSection(id);
    else this.selectedEventRequiredSections.update((ids) => [...ids, id]);
  }
  async loadSections(): Promise<void> {
    this.sectionsLoading.set(true);
    this.sectionError.set(null);
    try {
      const { sections } = await this.workspaceApi.listSections(
        this.auth.getToken() || undefined,
      );
      this.schoolSections.set(sections);
      if (!this.availableCourses().includes(this.announcementCourse)) {
        this.announcementCourse = this.availableCourses()[0] ?? this.courses[0];
      }
      if (
        !this.announcementYears().includes(this.announcementYearLevel)
      ) {
        this.announcementYearLevel = this.announcementYears()[0] ?? '';
      }
      this.announcementYearChanged();
    } catch (error) {
      this.sectionError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.sectionsLoading.set(false);
    }
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
    this.resetEventSectionPicker();
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
    this.resetEventSectionPicker();
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
    if (!this.eventForm.name.trim()) {
      this.eventError.set('Enter the event name.');
      return;
    }
    if (!this.eventForm.startTime || !this.eventForm.endTime) {
      this.eventError.set('Set when the event starts and ends.');
      return;
    }
    if (this.eventForm.endTime <= this.eventForm.startTime) {
      this.eventError.set('The end time must be after the start time.');
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
    this.eventError.set(null);
    const saved = this.events.save(
      {
        ...this.eventForm,
        graceMinutes,
        requiredSections: this.selectedEventRequiredSections(),
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
