import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { WorkspaceSyncService } from '../services/workspace-sync.service';

describe('authGuard', () => {
  function run(signedIn: boolean): Promise<boolean | UrlTree> {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { authenticated: () => signedIn } },
        {
          provide: WorkspaceSyncService,
          useValue: { initialize: () => Promise.resolve() },
        },
        {
          provide: Router,
          useValue: { createUrlTree: (commands: string[]) => commands.join('/') },
        },
      ],
    });
    return TestBed.runInInjectionContext(
      () => authGuard({} as never, {} as never),
    ) as Promise<boolean | UrlTree>;
  }

  it('lets a signed-in user through', async () => {
    expect(await run(true)).toBe(true);
  });

  it('redirects a signed-out visitor to the login screen', async () => {
    expect(await run(false)).toBe('/login');
  });
});
