import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { WorkspaceApiService } from './workspace-api.service';

describe('WorkspaceApiService', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the student ID and selected school details during registration', async () => {
    const service = TestBed.inject(WorkspaceApiService);
    const result = service.register('student.user', 'password123', {
      studentNumber: 'PPY-12345',
      name: 'Student Middle User',
      firstName: 'Student',
      middleName: 'Middle',
      lastName: 'User',
      course: 'BSIT',
      yearLevel: '1st Year',
      section: 'A',
      mobile: '09123456789',
    });

    const request = http.expectOne(`${environment.apiBaseUrl}/auth/register`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({
      studentNumber: 'PPY-12345',
      course: 'BSIT',
      yearLevel: '1st Year',
      section: 'A',
    });
    request.flush({
      token: 'token',
      username: 'student.user',
      role: 'student',
      studentId: 'PPY-12345',
    });
    await expect(result).resolves.toMatchObject({ studentId: 'PPY-12345' });
  });

  it('requests a shared app reset with the admin authorization token', async () => {
    const service = TestBed.inject(WorkspaceApiService);
    const result = service.resetSharedWorkspace('admin-token');

    const request = http.expectOne(`${environment.apiBaseUrl}/admin/reset`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.headers.get('Authorization')).toBe('Bearer admin-token');
    request.flush({ revision: 3 });
    await expect(result).resolves.toEqual({ revision: 3 });
  });

  it('ignores an API address saved by the previous app version', () => {
    localStorage.setItem(
      'school-event-api-url-v1',
      'https://old-tunnel.example/api',
    );

    const service = TestBed.inject(WorkspaceApiService);

    expect(service.baseUrl()).toBe(environment.apiBaseUrl);
  });

  it('remembers a manually configured API address using the current key', () => {
    const service = TestBed.inject(WorkspaceApiService);

    service.setBaseUrl('https://school-api.example/api/');

    expect(service.baseUrl()).toBe('https://school-api.example/api');
    expect(localStorage.getItem('school-event-api-url-v2')).toBe(
      'https://school-api.example/api',
    );
  });
});
