# Login Authentication Microservice

A minimal authentication microservice that handles user registration, login with invalid login attempt lockout, and plain-text password storage.

# Running the Service

```bash
npm install
npm start
```

The service listens on `http://localhost:3000`.

# Requesting and Receiving Data

### Register User

**Endpoint:** `POST /auth/register`

**Request:** Client sends a POST request with JSON body containing:

- `email`: User email (required)
- `password`: User password, minimum 6 characters (required)
- `name`: User display name (optional)

**Example:**

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "mypassword123",
    "name": "John Doe"
  }'
```

**Response (Success):** Client receives 201 CREATED Status Code and JSON body containing:

```json
{
  "message": "registered",
  "user": {
    "id": "uuid-string",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

**Response (Failure - User exists):** Client receives 409 CONFLICT Status Code and JSON body containing:

```json
{
  "error": "user exists"
}
```

**Response (Failure - Invalid input):** Client receives 400 BAD REQUEST Status Code and JSON body containing:

```json
{
  "error": "email and password required"
}
```

### Login User

**Endpoint:** `POST /auth/login`

**Request:** Client sends a POST request with JSON body containing:

- `email`: User email (required)
- `password`: User password (required)

**Example:**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "mypassword123"
  }'
```

**Response (Success):** Client receives 200 OK Status Code and JSON body containing:

```json
{
  "accessToken": "jwt-token-string",
  "expiresIn": "15m"
}
```

**Response (Failure - Invalid credentials):** Client receives 401 UNAUTHORIZED Status Code and JSON body containing:

```json
{
  "error": "invalid credentials",
  "remaining": 4
}
```

The `remaining` field shows how many login attempts are left before account lockout (max 5 attempts).

**Response (Failure - Too many attempts):** Client receives 429 TOO MANY REQUESTS Status Code and JSON body containing:

```json
{
  "error": "too many attempts"
}
```

The account will be locked for 15 minutes after 5 failed login attempts.

### Login Attempt Lockout

The service tracks failed login attempts per email address. After 5 consecutive failed attempts, the account is locked for 15 minutes. Successful login resets the attempt counter.

# Features

- **User Registration:** Create new user accounts with email and password
- **User Login:** Authenticate with email and password, receive access token
- **Invalid Login Handling:** Track failed attempts, lock account after 5 failures for 15 minutes
- **Plain-text Passwords:** Passwords stored without hashing (for development/testing only)
- **User Persistence:** User data persisted to `users.json` file
- **Access Tokens:** JWT-based access tokens with 15-minute expiry

# Data Storage

User data is persisted to `users.json` in the format:

```json
[
  [
    "user@example.com",
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "User Name",
      "password": "plaintext_password",
      "lastLogin": "2025-11-20T12:34:56.789Z"
    }
  ]
]
```

**Note:** The `users.json` file contains plain-text passwords and should be kept secure and not committed to version control. Add `users.json` to `.gitignore`.

# UML Sequence Diagram
