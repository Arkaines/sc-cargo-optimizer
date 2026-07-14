"use strict";

// Paliers de reputation (rang + seuil minimum) par entreprise/faction, issus
// de l'API communautaire Star Citizen Wiki (https://api.star-citizen.wiki/api
// /factions/{uuid}, champ reputation_ladder). "scope" indique quelle
// categorie de reputation (voir data/mission-reputation*.js) alimente ce
// palier pour cette entreprise (ex : "Hauling" pour Covalex). Genere le
// 2026-07-14 (35 entreprises).
const FACTION_REPUTATION_LADDERS =
{
  "Aciedo Communications": {
    "scope": "Technician",
    "standings": [
      {
        "name": "Applicant",
        "minReputation": 0
      },
      {
        "name": "Technician-in-Training",
        "minReputation": 1
      },
      {
        "name": "Jr. Technician",
        "minReputation": 3000
      },
      {
        "name": "Technician",
        "minReputation": 9000
      },
      {
        "name": "Sr. Technician",
        "minReputation": 27000
      },
      {
        "name": "Master Technician",
        "minReputation": 81000
      }
    ]
  },
  "Adagio Holdings": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "ArcCorp": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Bit Zeros": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Bounty Hunters Guild": {
    "scope": "BountyHunter_BountyHuntersGuild",
    "standings": [
      {
        "name": "Applicant",
        "minReputation": 0
      },
      {
        "name": "Probationary Guild Member",
        "minReputation": 1
      },
      {
        "name": "Junior Guild Member",
        "minReputation": 3000
      },
      {
        "name": "Guild Member",
        "minReputation": 10000
      },
      {
        "name": "Senior Guild Member",
        "minReputation": 40000
      },
      {
        "name": "Veteran Guild Member",
        "minReputation": 200000
      },
      {
        "name": "Guild Steward",
        "minReputation": 480000
      }
    ]
  },
  "Citizens For Prosperity": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Civilian Defense Force": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Clovus Darneely": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Covalex": {
    "scope": "Hauling",
    "standings": [
      {
        "name": "Trainee",
        "minReputation": 0
      },
      {
        "name": "Rookie",
        "minReputation": 50
      },
      {
        "name": "Junior",
        "minReputation": 250
      },
      {
        "name": "Member",
        "minReputation": 5250
      },
      {
        "name": "Experienced",
        "minReputation": 27750
      },
      {
        "name": "Senior",
        "minReputation": 77750
      },
      {
        "name": "Master",
        "minReputation": 237750
      }
    ]
  },
  "Crusader Industries": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Dead Saints": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Eckhart Security": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Foxwell Enforcement": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "FTL Courier": {
    "scope": "Hauling",
    "standings": [
      {
        "name": "Trainee",
        "minReputation": 0
      },
      {
        "name": "Rookie",
        "minReputation": 50
      },
      {
        "name": "Junior",
        "minReputation": 250
      },
      {
        "name": "Member",
        "minReputation": 5250
      },
      {
        "name": "Experienced",
        "minReputation": 27750
      },
      {
        "name": "Senior",
        "minReputation": 77750
      },
      {
        "name": "Master",
        "minReputation": 237750
      }
    ]
  },
  "Headhunters": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Hockrow Agency": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Hurston Dynamics": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "InterSec Defense Solutions": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Klescher Rehabilitation Facilities": {
    "scope": "Technician",
    "standings": [
      {
        "name": "Applicant",
        "minReputation": 0
      },
      {
        "name": "Technician-in-Training",
        "minReputation": 1
      },
      {
        "name": "Jr. Technician",
        "minReputation": 3000
      },
      {
        "name": "Technician",
        "minReputation": 9000
      },
      {
        "name": "Sr. Technician",
        "minReputation": 27000
      },
      {
        "name": "Master Technician",
        "minReputation": 81000
      }
    ]
  },
  "Ling Family Hauling": {
    "scope": "Hauling",
    "standings": [
      {
        "name": "Trainee",
        "minReputation": 0
      },
      {
        "name": "Rookie",
        "minReputation": 50
      },
      {
        "name": "Junior",
        "minReputation": 250
      },
      {
        "name": "Member",
        "minReputation": 5250
      },
      {
        "name": "Experienced",
        "minReputation": 27750
      },
      {
        "name": "Senior",
        "minReputation": 77750
      },
      {
        "name": "Master",
        "minReputation": 237750
      }
    ]
  },
  "microTech": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Northrock Service Group": {
    "scope": "Security_MercenaryGuild",
    "standings": [
      {
        "name": "Applicant",
        "minReputation": 0
      },
      {
        "name": "Security Trainee",
        "minReputation": 1
      },
      {
        "name": "Jr. Security Contractor",
        "minReputation": 5000
      },
      {
        "name": "Security Contractor",
        "minReputation": 30000
      },
      {
        "name": "Sr. Security Contractor",
        "minReputation": 120000
      },
      {
        "name": "Lead Security Contractor",
        "minReputation": 480000
      },
      {
        "name": "Elite Security Contractor",
        "minReputation": 1600000
      }
    ]
  },
  "Rayari Incorporated": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Red Wind Linehaul": {
    "scope": "Hauling",
    "standings": [
      {
        "name": "Trainee",
        "minReputation": 0
      },
      {
        "name": "Rookie",
        "minReputation": 50
      },
      {
        "name": "Junior",
        "minReputation": 250
      },
      {
        "name": "Member",
        "minReputation": 5250
      },
      {
        "name": "Experienced",
        "minReputation": 27750
      },
      {
        "name": "Senior",
        "minReputation": 77750
      },
      {
        "name": "Master",
        "minReputation": 237750
      }
    ]
  },
  "Ruto": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Shubin Interstellar": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Tar Pits": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Tecia \"Twitch\" Pacheco": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Unified Distribution Management": {
    "scope": "Hauling",
    "standings": [
      {
        "name": "Trainee",
        "minReputation": 0
      },
      {
        "name": "Rookie",
        "minReputation": 50
      },
      {
        "name": "Junior",
        "minReputation": 250
      },
      {
        "name": "Member",
        "minReputation": 5250
      },
      {
        "name": "Experienced",
        "minReputation": 27750
      },
      {
        "name": "Senior",
        "minReputation": 77750
      },
      {
        "name": "Master",
        "minReputation": 237750
      }
    ]
  },
  "United Wayfarers Club": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Vaughn": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Wallace Klim": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  },
  "Wikelo Emporium": {
    "scope": "Wikelo",
    "standings": [
      {
        "name": "Very Best Customer",
        "minReputation": 999
      },
      {
        "name": "Very Good Customer",
        "minReputation": 340
      },
      {
        "name": "New Customer",
        "minReputation": 0
      }
    ]
  },
  "Wildstar Racing": {
    "scope": "HoverTimeTrial",
    "standings": [
      {
        "name": null,
        "minReputation": 0
      },
      {
        "name": null,
        "minReputation": 1
      },
      {
        "name": null,
        "minReputation": 1000
      },
      {
        "name": null,
        "minReputation": 2000
      },
      {
        "name": null,
        "minReputation": 4000
      },
      {
        "name": null,
        "minReputation": 8000
      },
      {
        "name": null,
        "minReputation": 16000
      },
      {
        "name": null,
        "minReputation": 32000
      }
    ]
  },
  "XenoThreat": {
    "scope": "FactionReputation",
    "standings": [
      {
        "name": "Neutral",
        "minReputation": 0
      },
      {
        "name": "Jr. Contractor",
        "minReputation": 800
      },
      {
        "name": "Contractor",
        "minReputation": 2200
      },
      {
        "name": "Sr. Contractor",
        "minReputation": 5800
      },
      {
        "name": "Veteran Contractor",
        "minReputation": 15000
      },
      {
        "name": "Head Contractor",
        "minReputation": 38000
      },
      {
        "name": "Elite Contractor",
        "minReputation": 95250
      }
    ]
  }
};
