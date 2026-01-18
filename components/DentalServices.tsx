
import React from 'react';
import { DentalService } from '../types';

const services: DentalService[] = [
  { id: '1', title: 'Oral Prophylaxis', description: 'Professional teeth cleaning and scaling to prevent gum disease.', icon: 'fa-tooth' },
  { id: '2', title: 'Tooth Extraction', description: 'Expert removal of damaged or problematic teeth with minimal discomfort.', icon: 'fa-kit-medical' },
  { id: '3', title: 'Cosmetic Filling', description: 'High-quality tooth-colored composite restoration for a natural look.', icon: 'fa-fill-drip' },
  { id: '4', title: 'Braces / Ortho', description: 'Customized treatment plans for perfect alignment and bite correction.', icon: 'fa-teeth' },
  { id: '5', title: 'Root Canal Therapy', description: 'Saving your natural teeth from infection with advanced techniques.', icon: 'fa-vial-virus' },
  { id: '6', title: 'Professional Whitening', description: 'Instantly brighten your smile with our safe laser whitening system.', icon: 'fa-wand-magic-sparkles' }
];

const DentalServices: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="font-bold text-slate-900 tracking-tight">Our Specializations</h3>
        <div className="h-px flex-1 bg-slate-100"></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services.map((service) => (
          <div 
            key={service.id} 
            className="group p-5 rounded-2xl glass-card hover:bg-white transition-all duration-300 shadow-sm flex gap-5 border border-slate-100 hover:border-blue-200 cursor-default"
          >
            <div className="w-14 h-14 rounded-2xl bg-blue-50 group-hover:bg-blue-500 transition-colors flex items-center justify-center text-blue-600 group-hover:text-white shrink-0 shadow-sm">
              <i className={`fas ${service.icon} text-2xl`}></i>
            </div>
            <div>
              <h3 className="font-bold text-slate-800 leading-tight group-hover:text-blue-700 transition-colors">{service.title}</h3>
              <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{service.description}</p>
              <div className="mt-3 flex items-center gap-2 text-[9px] font-bold text-blue-500 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                <span>View Details</span>
                <i className="fas fa-chevron-right text-[7px]"></i>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DentalServices;
