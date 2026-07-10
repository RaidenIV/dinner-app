# HomePlate Planner

HomePlate Planner is a shared household meal planning app built with plain HTML, CSS, JavaScript, Node.js, Express, and MongoDB.

It helps a household decide what to eat by combining a weekly breakfast/lunch/dinner planner, recipe organizer, random restaurant picker, grocery list, meal history, suggestions, and stats.

## Features

- Email/password signup and login
- Shared household accounts with an invite code
- Weekly planner with breakfast, lunch, and dinner slots
- Recipe organizer with ingredients, instructions, tags, ratings, favorites, and usage tracking
- Automatic AI text extraction from recipe photos and PDFs
- Review-first AI cleanup for extracted, pasted, or typed recipe text
- Restaurant organizer with cuisine, price, tags, favorite dishes, ratings, and visit tracking
- Random restaurant selector with cuisine, tag, and price filters
- Shared grocery list
- Grocery generation from recipes planned for the week
- Saved meal history
- Suggestions based on rating, favorites, filters, and recent meal history
- Stats for recipe count, restaurant count, grocery count, planning completion, cuisine breakdown, meal type breakdown, and most-used meals
- Responsive dark UI

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- Database: MongoDB with Mongoose
- AI recipe scan OCR: OpenAI Responses API with image/PDF inputs
- AI recipe cleanup: OpenAI Responses API with Structured Outputs
- Auth: JWT + bcrypt password hashing
- Hosting: Railway
- Source control: GitHub

## Project Structure

```text
meal-planner-app/
  public/
    index.html
    styles.css
    app.js
  server.js
  package.json
  .env.example
  .gitignore
  README.md
```

## Local Setup

1. Install Node.js 20 or newer.
2. Install MongoDB locally or create a MongoDB database service.
3. Copy `.env.example` to `.env`.
4. Update the values in `.env`.
5. Install dependencies.
6. Start the server.

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Environment Variables

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/meal_planner
JWT_SECRET=replace-this-with-a-long-random-secret
PORT=3000
NODE_ENV=development
OPENAI_API_KEY=<your OpenAI API key>
OPENAI_RECIPE_MODEL=gpt-5.6-luna
OPENAI_RECIPE_OCR_MODEL=
AI_RECIPE_OCR_ENABLED=true
AI_RECIPE_CLEANUP_ENABLED=true
AI_RECIPE_OCR_MAX_REQUESTS_PER_HOUR=20
AI_RECIPE_MAX_REQUESTS_PER_HOUR=20
```

For production, use a long random value for `JWT_SECRET`.

## Railway Deployment

1. Push this project to a GitHub repository.
2. Create a new Railway project.
3. Add a MongoDB database service or connect your existing MongoDB provider.
4. Add a new Railway service from your GitHub repository.
5. Set these environment variables on the app service:

```bash
MONGODB_URI=<your MongoDB connection string>
JWT_SECRET=<long random secret>
NODE_ENV=production
OPENAI_API_KEY=<your OpenAI API key>
OPENAI_RECIPE_MODEL=gpt-5.6-luna
OPENAI_RECIPE_OCR_MODEL=
AI_RECIPE_OCR_ENABLED=true
AI_RECIPE_CLEANUP_ENABLED=true
AI_RECIPE_OCR_MAX_REQUESTS_PER_HOUR=20
AI_RECIPE_MAX_REQUESTS_PER_HOUR=20
```

6. Deploy the service.

Railway should detect the Node app and run:

```bash
npm start
```

## AI Recipe Scan Import

The Recipe Import Assistant now supports a review-first scan workflow:

1. Open **Recipes**.
2. Click **Import Printed Recipe**.
3. Take a photo or upload a JPG, PNG, WEBP, GIF, or PDF recipe scan.
4. HomePlate automatically extracts the visible recipe text into the editable text area.
5. Review and correct the extracted text. Use **Extract Text From Scan** to retry when needed.
6. Click **Clean Up With AI**.
7. Review the generated recipe fields, confidence score, warnings, and unclear fields.
8. Edit anything that needs correction.
9. Save the recipe only after review.

The scan endpoint and cleanup endpoint are both authenticated and keep the OpenAI API key on the server. Image and PDF payloads are size-limited, extracted text is limited to 15,000 characters, and scan extraction and cleanup each have configurable per-user hourly request limits. Neither OCR nor AI cleanup saves a recipe automatically.

`OPENAI_RECIPE_OCR_MODEL` is optional. Leave it blank to use the same model configured in `OPENAI_RECIPE_MODEL`. The existing manual text-paste and **Fill From Text** workflows remain available when a scan is unreadable or AI is disabled.

## First Use

1. Create your account.
2. Enter a household name during signup.
3. Open Settings and copy the invite code.
4. Have your wife create an account using that invite code.
5. Add recipes and favorite restaurants.
6. Plan the week.
7. Generate the grocery list from planned recipes.
8. Mark meals as eaten to build history and stats.

## Ingredient Format

The recipe ingredient box supports simple one-item-per-line entries:

```text
Chicken thighs
Rice
Smoked paprika
```

It also supports a structured format:

```text
2 | lb | chicken thighs | Meat
1 | cup | rice | Pantry
1 | tsp | smoked paprika | Pantry
```

The structured format is:

```text
quantity | unit | name | category
```

## Notes

This is an MVP meant to be extended. Good next improvements include recipe editing UI, pantry inventory, recipe URL importing, drag-and-drop planner slots, push reminders, and smarter suggestion weighting based on both users' preferences.
