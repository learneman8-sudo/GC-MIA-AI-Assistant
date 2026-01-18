
import React from 'react';
import { DentalService } from '../types';

const services: DentalService[] = [
  { id: '1', title: 'Oral Prophylaxis', description: 'Professional dental cleaning (₱1,000 – ₱1,500).', icon: 'fa-tooth' },
  { id: '2', title: 'Tooth Extraction', description: 'Safe removal of damaged teeth (₱1,000 – ₱3,000).', icon: 'fa-kit-medical' },
  { id: '3', title: 'Pasta / Filling', description: 'Restoration for cavities (₱1,000 – ₱2,500).', icon: 'fa-fill-drip' },
  { id: '4', title: 'Braces', description: 'Orthodontic treatment for a perfect smile (₱40k – ₱80k).', icon: 'fa-teeth' },
  { id: '5', title: 'Root Canal', description: 'Specialized treatment to save your natural teeth.', icon: 'fa-vial-virus' },
  { id: '6', title: 'Teeth Whitening', description: 'Professional brightening for a glowing smile.', icon: 'fa-wand-magic-sparkles' }
];

const DentalServices: React.FC = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
      {services.map((service) => (
        <div key={service.id} className="p-4 rounded-xl glass-card hover:bg-white transition-all duration-300 shadow-sm flex gap-4 border border-slate-100 hover:border-blue-200">
          <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
            <i className={`fas ${service.icon} text-xl`}></i>
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 leading-tight">{service.title}</h3>
            <p className="text-xs text-slate-500 mt-1">{service.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default DentalServices;
