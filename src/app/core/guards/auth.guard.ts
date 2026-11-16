import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { WorkspaceSyncService } from '../services/workspace-sync.service';

/**
 * A plain-function guard. It waits for the saved session to be checked, then
 * returns a UrlTree so signed-out visitors are redirected to the login screen
 * instead of landing on a blank page. (The server still checks the token.)
 */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await inject(WorkspaceSyncService).initialize();
  return auth.authenticated() || router.createUrlTree(['/login']);
};
