import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { WorkspaceApiService } from './workspace-api.service';

describe('WorkspaceApiService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
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
