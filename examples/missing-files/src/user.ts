export interface User {
  firstName: string;
  lastName?: string;
}

export function displayName(user: User): string {
  const firstName = user.firstName.trim();
  const lastName = user.lastName?.trim();
  return lastName ? `${firstName} ${lastName}` : firstName;
}
