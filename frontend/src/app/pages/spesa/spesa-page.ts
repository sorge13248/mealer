import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'app-spesa-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [],
    templateUrl: './spesa-page.html',
    styleUrl: './spesa-page.scss'
})
export class SpesaPage {}
