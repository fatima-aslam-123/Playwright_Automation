import { test, expect } from '@playwright/test';
import { login } from './utils/login';

test.beforeEach(async ({ page }) => {

  await login(page);

});

test('Companies page should enable Apply Filters when a Specific company is selected', async ({ page }) => {

  // Arrange — login handled in beforeEach, confirm we landed on companies search
  await expect(page).toHaveURL('https://qa.zenbee.io/search/companies');

  // wait for the loading splash to clear and filter sidebar to be interactive
  await expect(page.getByRole('button', { name: 'Specific companies' })).toBeVisible();

  const applyFilters = page.getByRole('button', { name: 'Apply Filters' });
  await expect(applyFilters).toBeDisabled();

  // Act — expand the "Specific companies" accordion and type a company name
  await page.getByRole('button', { name: 'Specific companies' }).click();

  const companyInput = page.getByRole('combobox', { name: 'Search company...' });
  await companyInput.click();
  await companyInput.pressSequentially('Google', { delay: 150 });

  // pick the first suggestion from the typeahead dropdown
  await page.getByRole('option').filter({ hasText: /google/i }).first().click();

  // Assert — Apply Filters button becomes enabled
  await expect(applyFilters).toBeEnabled();

});