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
		path: 'dispensa/macro-category',
		redirectTo: '/dispensa',
		pathMatch: 'full'
	},
	{
		path: 'dispensa/macro-category/:macroCategory',
		loadComponent: () =>
			import('./pages/dispensa/macro-category/macro-category-page').then((module) => module.MacroCategoryPage)
	},
	{
		path: 'dispensa/stock-volatile',
		redirectTo: '/dispensa',
		pathMatch: 'full'
	},
	{
		path: 'dispensa/stock-volatile/:section',
		loadComponent: () =>
			import('./pages/dispensa/stock-volatile/stock-volatile-page').then((module) => module.StockVolatilePage)
	},
	{
		path: 'dispensa/gestione-dati',
		loadComponent: () =>
			import('./pages/dispensa/gestione-dati/gestione-dati-page').then((module) => module.GestioneDatiPage)
	},
	{
		path: 'meal-planner',
		loadComponent: () =>
			import('./pages/meal-planner/meal-planner-page').then((module) => module.MealPlannerPage)
	},
	{
		path: 'spesa',
		redirectTo: '/spesa/dashboard',
		pathMatch: 'full'
	},
	{
		path: 'spesa/dashboard',
		loadComponent: () =>
			import('./pages/spesa/dashboard/spesa-dashboard-page').then((module) => module.SpesaDashboardPage)
	},
	{
		path: 'spesa/carica-scontrino',
		loadComponent: () => import('./pages/spesa/carica-scontrino/spesa-page').then((module) => module.SpesaPage)
	}
];
