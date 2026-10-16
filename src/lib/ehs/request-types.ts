export type Department = "Transport" | "EHS" | "Projects" | "Finance";
export type FinanceCategory = "Material" | "Equipment" | "Labor" | "Transport" | "Other";

export type MoneyType = {
  id: string;
  label: string;
  hint: string;
  department: Department;
  category: FinanceCategory;
  unit?: string;
};

export const MONEY_TYPES: MoneyType[] = [
  { id: "Fuel", label: "Fuel", hint: "Diesel, petrol or lubricants", department: "Transport", category: "Transport", unit: "litres" },
  { id: "Vehicle repair", label: "Vehicle repair", hint: "Parts and maintenance", department: "Transport", category: "Equipment" },
  { id: "Transport", label: "Transport", hint: "Vehicle hire or trip costs", department: "Transport", category: "Transport" },
  { id: "PPE", label: "PPE", hint: "Protective equipment", department: "EHS", category: "Equipment" },
  { id: "First aid", label: "First aid", hint: "First aid supplies", department: "EHS", category: "Material" },
  { id: "Safety training", label: "Safety training", hint: "Training and certification", department: "EHS", category: "Other" },
  { id: "Materials", label: "Materials", hint: "Site materials and consumables", department: "Projects", category: "Material" },
  { id: "Tools", label: "Tools", hint: "Tools and small equipment", department: "Projects", category: "Equipment" },
  { id: "Labour", label: "Labour", hint: "Site labour and specialist work", department: "Projects", category: "Labor" },
  { id: "Other", label: "Other", hint: "Other company purchase", department: "Finance", category: "Other" },
];

export function moneyTypeById(id: string): MoneyType {
  return MONEY_TYPES.find((type) => type.id === id) ?? MONEY_TYPES[MONEY_TYPES.length - 1]!;
}

export function departmentNeedsReview(department: Department): boolean {
  void department;
  return false;
}
