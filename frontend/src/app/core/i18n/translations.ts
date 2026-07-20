// UI string dictionaries. Each language provides the same set of keys; `TranslationKey`
// is derived from English so a missing Bulgarian key is a compile error.

export const en = {
  // App / shell
  'app.name': 'Calorie Tracker',
  'nav.diary': 'Diary',
  'nav.myFoods': 'My Foods',
  'nav.recipes': 'Recipes',
  'account.title': 'Account',
  'account.signedIn': 'Signed in',
  'account.close': 'Close',
  'account.signOut': 'Sign out',
  'account.language': 'Language',
  'common.comingSoon': 'Coming soon.',

  // Meals
  'meal.breakfast': 'Breakfast',
  'meal.lunch': 'Lunch',
  'meal.dinner': 'Dinner',
  'meal.snack': 'Snack',

  // Diary
  'diary.today': 'Today',
  'diary.yesterday': 'Yesterday',
  'diary.tomorrow': 'Tomorrow',
  'diary.previousDay': 'Previous day',
  'diary.nextDay': 'Next day',
  'diary.jumpToToday': 'Jump to today',
  'diary.kcalLeft': 'kcal left today',
  'diary.kcalOver': 'kcal over today',
  'diary.ofBudget': 'of {kcal} budget',
  'diary.meals': 'Meals',
  'diary.protein': 'Protein',
  'diary.carbs': 'Carbs',
  'diary.fat': 'Fat',
  'diary.nothingLogged': 'Nothing logged',
  'diary.nothingLoggedMeal': 'Nothing logged for this meal yet.',
  'diary.items': 'Items',
  'diary.oneItem': '1 item',
  'diary.manyItems': '{n} items',
  'diary.add': 'Add',
  'diary.addFood': 'Add food',
  'diary.addFoodTo': 'Add food to {meal}',
  'diary.kcal': 'kcal',
  'diary.back': 'Back',

  // Entry edit
  'entry.portionGrams': 'Portion (grams)',
  'entry.decreaseGrams': 'Decrease grams',
  'entry.increaseGrams': 'Increase grams',
  'entry.kcalPer100': 'kcal/100g',
  'entry.saveChanges': 'Save changes',
  'entry.deleteEntry': 'Delete entry',
  'macro.p': 'P',
  'macro.c': 'C',
  'macro.f': 'F',

  // Daily goals
  'goals.title': 'Daily goals',
  'goals.calorieGoal': 'Calorie goal (kcal)',
  'goals.macroGoals': 'Macro goals (grams / day)',
  'goals.proteinG': 'Protein g',
  'goals.carbsG': 'Carbs g',
  'goals.fatG': 'Fat g',
  'goals.save': 'Save goals',

  // Auth — shared
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.emailPlaceholder': 'you@email.com',

  // Auth — login
  'auth.login.title': 'Sign in',
  'auth.login.submit': 'Sign in',
  'auth.login.forgot': 'Forgot password?',
  'auth.login.noAccount': 'No account?',
  'auth.login.createOne': 'Create one',

  // Auth — register
  'auth.register.title': 'Create account',
  'auth.register.submit': 'Create account',
  'auth.register.passwordHint': 'Minimum 8 characters.',
  'auth.register.haveAccount': 'Have an account?',
  'auth.register.signIn': 'Sign in',

  // Auth — forgot
  'auth.forgot.title': 'Reset password',
  'auth.forgot.intro': "Enter your email and we'll send a reset link.",
  'auth.forgot.submit': 'Send reset link',
  'auth.forgot.sent': 'If that email exists, a link is on its way.',
  'auth.forgot.back': 'Back',

  // Validation / errors
  'error.emailRequired': 'Email is required.',
  'error.emailInvalid': 'Enter a valid email address.',
  'error.passwordRequired': 'Password is required.',
  'error.passwordMin': 'Password must be at least 8 characters.',
  'error.invalidCredentials': 'Invalid email or password.',
  'error.emailTaken': 'That email is already in use.',
  'error.network': 'Network error. Please try again.',
  'error.generic': 'Something went wrong. Please try again.',
} as const;

export type TranslationKey = keyof typeof en;

export const bg: Record<TranslationKey, string> = {
  // App / shell
  'app.name': 'Калориен Тракер',
  'nav.diary': 'Дневник',
  'nav.myFoods': 'Моите храни',
  'nav.recipes': 'Рецепти',
  'account.title': 'Профил',
  'account.signedIn': 'Влязъл в профила',
  'account.close': 'Затвори',
  'account.signOut': 'Изход',
  'account.language': 'Език',
  'common.comingSoon': 'Очаквайте скоро.',

  // Meals
  'meal.breakfast': 'Закуска',
  'meal.lunch': 'Обяд',
  'meal.dinner': 'Вечеря',
  'meal.snack': 'Междинно',

  // Diary
  'diary.today': 'Днес',
  'diary.yesterday': 'Вчера',
  'diary.tomorrow': 'Утре',
  'diary.previousDay': 'Предишен ден',
  'diary.nextDay': 'Следващ ден',
  'diary.jumpToToday': 'Към днес',
  'diary.kcalLeft': 'ккал остават днес',
  'diary.kcalOver': 'ккал над целта днес',
  'diary.ofBudget': 'от бюджет {kcal}',
  'diary.meals': 'Хранения',
  'diary.protein': 'Протеини',
  'diary.carbs': 'Въглехидрати',
  'diary.fat': 'Мазнини',
  'diary.nothingLogged': 'Няма записи',
  'diary.nothingLoggedMeal': 'Все още няма записи за това хранене.',
  'diary.items': 'Записи',
  'diary.oneItem': '1 запис',
  'diary.manyItems': '{n} записа',
  'diary.add': 'Добави',
  'diary.addFood': 'Добави храна',
  'diary.addFoodTo': 'Добави храна към {meal}',
  'diary.kcal': 'ккал',
  'diary.back': 'Назад',

  // Entry edit
  'entry.portionGrams': 'Порция (грамове)',
  'entry.decreaseGrams': 'Намали грамовете',
  'entry.increaseGrams': 'Увеличи грамовете',
  'entry.kcalPer100': 'ккал/100г',
  'entry.saveChanges': 'Запази промените',
  'entry.deleteEntry': 'Изтрий записа',
  'macro.p': 'П',
  'macro.c': 'В',
  'macro.f': 'М',

  // Daily goals
  'goals.title': 'Дневни цели',
  'goals.calorieGoal': 'Калорийна цел (ккал)',
  'goals.macroGoals': 'Целеви макроси (грамове / ден)',
  'goals.proteinG': 'Протеини г',
  'goals.carbsG': 'Въглехидрати г',
  'goals.fatG': 'Мазнини г',
  'goals.save': 'Запази целите',

  // Auth — shared
  'auth.email': 'Имейл',
  'auth.password': 'Парола',
  'auth.emailPlaceholder': 'you@email.com',

  // Auth — login
  'auth.login.title': 'Вход',
  'auth.login.submit': 'Вход',
  'auth.login.forgot': 'Забравена парола?',
  'auth.login.noAccount': 'Нямаш профил?',
  'auth.login.createOne': 'Създай',

  // Auth — register
  'auth.register.title': 'Създай профил',
  'auth.register.submit': 'Създай профил',
  'auth.register.passwordHint': 'Минимум 8 символа.',
  'auth.register.haveAccount': 'Вече имаш профил?',
  'auth.register.signIn': 'Вход',

  // Auth — forgot
  'auth.forgot.title': 'Смяна на парола',
  'auth.forgot.intro': 'Въведи имейла си и ще ти изпратим връзка за смяна.',
  'auth.forgot.submit': 'Изпрати връзка',
  'auth.forgot.sent': 'Ако този имейл съществува, връзката вече пътува.',
  'auth.forgot.back': 'Назад',

  // Validation / errors
  'error.emailRequired': 'Имейлът е задължителен.',
  'error.emailInvalid': 'Въведи валиден имейл адрес.',
  'error.passwordRequired': 'Паролата е задължителна.',
  'error.passwordMin': 'Паролата трябва да е поне 8 символа.',
  'error.invalidCredentials': 'Грешен имейл или парола.',
  'error.emailTaken': 'Този имейл вече се използва.',
  'error.network': 'Мрежова грешка. Опитай отново.',
  'error.generic': 'Нещо се обърка. Опитай отново.',
};

export const dictionaries = { en, bg } as const;

export type Language = keyof typeof dictionaries;
