import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideChefHat, LucideDynamicIcon, LucidePackage, LucideShoppingCart } from '@lucide/angular';

@Component({
  selector: 'app-main-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, LucideDynamicIcon],
  templateUrl: './main-menu.html',
  styleUrl: './main-menu.scss',
})
export class MainMenuComponent {
  protected readonly pantryIcon = LucidePackage;
  protected readonly plannerIcon = LucideChefHat;
  protected readonly shoppingIcon = LucideShoppingCart;
}
