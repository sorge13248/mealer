import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-loading-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './loading-spinner.html',
  styleUrl: './loading-spinner.scss',
  host: {
    role: 'status',
    'aria-live': 'polite'
  }
})
export class LoadingSpinnerComponent {
  readonly label = input<string>('Caricamento');
}
