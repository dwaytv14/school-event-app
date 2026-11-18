import { inject, Injectable } from '@angular/core';
import { Student } from '../models/school-event.models';
import { DemoStoreService } from './demo-store.service';
import { isStudentRequired } from './event-roster';

@Injectable({ providedIn: 'root' })
export class StudentService {
  private readonly store = inject(DemoStoreService);

  add(input: Omit<Student, 'id'>): Student {
    const student: Student = {
      id: `STU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name.trim(),
      section: input.section.trim(),
      mobile: input.mobile.trim(),
      course: input.course,
      yearLevel: input.yearLevel,
      sectionId: input.sectionId,
    };

    this.store.update((state) => {
      state.students.push(student);
      state.events.forEach((event) => {
        if (
          isStudentRequired(event, student) &&
          !event.sections.includes(student.section)
        ) {
          event.sections.push(student.section);
        }
      });
    });

    return student;
  }
}