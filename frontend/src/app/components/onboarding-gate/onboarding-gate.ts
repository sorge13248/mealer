import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-onboarding-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  templateUrl: './onboarding-gate.html',
  styleUrl: './onboarding-gate.scss'
})
export class OnboardingGateComponent {
  // The onboarding flow is no longer needed because Grocy integration lives in the backend.
}
