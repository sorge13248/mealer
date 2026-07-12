import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OnboardingGateComponent } from './components/onboarding-gate/onboarding-gate';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OnboardingGateComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
