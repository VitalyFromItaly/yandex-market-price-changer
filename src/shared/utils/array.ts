export function isTwoDimensionalArray(arr: any[]): boolean {
  if (!Array.isArray(arr)) {
    return false;
  }
  return (
    Array.isArray(arr) && // Проверяем, что это массив
    arr.every(element => Array.isArray(element)) // Все элементы должны быть массивами
  );
}
