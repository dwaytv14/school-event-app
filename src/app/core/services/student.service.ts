import { Injectable } from '@angular/core';
import { Student } from '../models/school-event.models';
import { DemoStoreService } from './demo-store.service';

@Injectable({ providedIn: 'root' })
export class StudentService {
  constructor(private readonly store: DemoStoreService) {}

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
        if (!event.sections.includes(student.section))
          event.sections.push(student.section);

        const sectionSeats = event.seats.filter(
          (seat) => seat.section === student.section,
        );
        const sectionId = student.section.replaceAll(' ', '-').toLowerCase();
        if (sectionSeats.length === 0) {
          event.seats.push(
            ...Array.from({ length: 12 }, (_, index) => ({
              id: `${event.id}-${sectionId}-${index + 1}`,
              section: student.section,
              row: Math.floor(index / 6) + 1,
              number: (index % 6) + 1,
              studentId: index === 0 ? student.id : null,
            })),
          );
          return;
        }

        const availableSeat = sectionSeats.find((seat) => !seat.studentId);
        if (availableSeat) {
          availableSeat.studentId = student.id;
          return;
        }

        const seatCount = sectionSeats.length;
        const seatNumber = seatCount + 1;
        event.seats.push({
          id: `${event.id}-${sectionId}-${seatNumber}`,
          section: student.section,
          row: Math.floor(seatCount / 6) + 1,
          number: (seatCount % 6) + 1,
          studentId: student.id,
        });
      });
    });

    return student;
  }
}