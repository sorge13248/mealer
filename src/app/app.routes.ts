import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		loadComponent: () => import('./pages/home/home-page').then((module) => module.HomePage)
	},
	{
		path: 'macrocategoria/:macroCategory',
		loadComponent: () =>
			import('./pages/macro-category/macro-category-page').then((module) => module.MacroCategoryPage)
	}
];
