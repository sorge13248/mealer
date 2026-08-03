import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideDynamicIcon } from '@lucide/angular';

@Component({
  selector: 'app-back-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideDynamicIcon],
  templateUrl: './back-button.html',
  styleUrl: './back-button.scss',
})
export class BackButtonComponent {
  readonly to = input<string>('..');
  readonly label = input<string>('Indietro');
  readonly ariaLabel = input<string | null>(null);
  protected readonly icon = LucideArrowLeft;
}
