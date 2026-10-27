import { Injectable, signal } from '@angular/core';
import {
  AppState,
} from '../models/school-event.models';

function createEmptyState(): AppState {
  return {
    role: null,
    studentId: '',
    selectedEventId: '',
    simulatedOffline: false,
    students: [],
    events: [],
    attendance: [],
    violations: [],
    messages: [],
    syncItems: [],
  };
}

@Injectable({ providedIn: 'root' })
export class DemoStoreService {
  private readonly storageKey = 'school-event-attendance-v2';
  private readonly listeners = new Set<(state: AppState) => void>();
  readonly state = signal<AppState>(this.load());

  update(change: (state: AppState) => void): void {
    const next = structuredClone(this.state());
    change(next);
    this.state.set(next);
    this.persist(next);
    this.listeners.forEach((listener) => listener(next));
  }

  replace(next: AppState, notify = true): void {
    const copy = structuredClone(next);
    this.state.set(copy);
    this.persist(copy);
    if (notify) this.listeners.forEach((listener) => listener(copy));
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(state: AppState): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Preserve the current session if browser storage is unavailable.
    }
  }

  reset(): void {
    const emptyState = createEmptyState();
    this.replace(emptyState);
  }

  private load(): AppState {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) return JSON.parse(saved) as AppState;
    } catch {
      // Fall back to an empty workspace if saved data is unreadable.
    }
    return createEmptyState();
  }
}
