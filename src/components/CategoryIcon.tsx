import React from 'react';
import {
  Baby,
  Car,
  Gift,
  HeartPulse,
  Home,
  Landmark,
  PiggyBank,
  Receipt,
  Shield,
  ShoppingBag,
  Sparkles,
  Tag,
  Utensils,
  Wallet,
} from 'lucide-react';

export const CATEGORY_ICON_OPTIONS = [
  { id: 'heart-pulse', label: 'Medical' },
  { id: 'baby', label: 'Baby' },
  { id: 'gift', label: 'Celebration' },
  { id: 'landmark', label: 'EMI / Bank' },
  { id: 'shield', label: 'Insurance' },
  { id: 'piggy-bank', label: 'Savings / FD' },
  { id: 'receipt', label: 'Tax / Bills' },
  { id: 'shopping-bag', label: 'Shopping' },
  { id: 'home', label: 'Home' },
  { id: 'car', label: 'Transport' },
  { id: 'utensils', label: 'Dining' },
  { id: 'wallet', label: 'Income' },
  { id: 'tag', label: 'General' },
];

export const CATEGORY_COLOR_OPTIONS = [
  '#0D9488',
  '#059669',
  '#2563EB',
  '#D97706',
  '#DC2626',
  '#7C3AED',
  '#DB2777',
  '#475569',
];

export const CategoryIcon: React.FC<{ icon: string; className?: string }> = ({
  icon,
  className = 'w-4 h-4',
}) => {
  switch (icon) {
    case 'heart-pulse':
      return <HeartPulse className={className} />;
    case 'baby':
      return <Baby className={className} />;
    case 'gift':
      return <Gift className={className} />;
    case 'landmark':
      return <Landmark className={className} />;
    case 'shield':
      return <Shield className={className} />;
    case 'piggy-bank':
      return <PiggyBank className={className} />;
    case 'receipt':
      return <Receipt className={className} />;
    case 'shopping-bag':
      return <ShoppingBag className={className} />;
    case 'home':
      return <Home className={className} />;
    case 'car':
      return <Car className={className} />;
    case 'utensils':
      return <Utensils className={className} />;
    case 'wallet':
      return <Wallet className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    default:
      return <Tag className={className} />;
  }
};
