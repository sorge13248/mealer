import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChefHat, LucideDynamicIcon, LucidePackage, LucideShoppingCart } from '@lucide/angular';

@Component({
    selector: 'app-home-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, LucideDynamicIcon],
    templateUrl: './home-page.html',
    styleUrl: './home-page.scss'
})
export class HomePage {
    protected readonly pantryIcon = LucidePackage;
    protected readonly plannerIcon = LucideChefHat;
    protected readonly shoppingIcon = LucideShoppingCart;
}
