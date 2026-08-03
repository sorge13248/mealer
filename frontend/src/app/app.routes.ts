import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		loadComponent: () => import('./pages/home/home-page').then((module) => module.HomePage)
	},
	{
		path: 'dispensa',
		loadComponent: () => import('./pages/dispensa/dispensa-page').then((module) => module.DispensaPage)
	},
	{
		path: 'macrocategoria',
		redirectTo: '/dispensa',
		pathMatch: 'full'
	},
	{
		path: 'macrocategoria/:macroCategory',
		loadComponent: () =>
			import('./pages/macro-category/macro-category-page').then((module) => module.MacroCategoryPage)
	},
	{
		path: 'stock-volatile',
		redirectTo: '/dispensa',
		pathMatch: 'full'
	},
	{
		path: 'stock-volatile/:section',
		loadComponent: () =>
			import('./pages/stock-volatile/stock-volatile-page').then((module) => module.StockVolatilePage)
	},
	{
		path: 'pianificatore-pasto',
		loadComponent: () =>
			import('./pages/meal-planner/meal-planner-page').then((module) => module.MealPlannerPage)
	},
	{
		path: 'spesa',
		loadComponent: () =>
			import('./pages/spesa-dashboard/spesa-dashboard-page').then((module) => module.SpesaDashboardPage)
	},
	{
		path: 'spesa/nuova',
		loadComponent: () => import('./pages/spesa/spesa-page').then((module) => module.SpesaPage)
	}
];
