/**
 * What the ThinkLab Quick Install add-on can put on a Ventoy stick, as plain data. This is a sanitised snapshot of the add-on's
 * catalog (github.com/fernan-89/thinklab-quickinstall): system families, languages, editions and the extras it installs.
 * It holds no machine names, serial numbers, keys or credentials; the per-machine kits live only on the owner's own stick.
 */
export type Family = 'Windows' | 'Linux' | 'Recovery';
export type Role = 'Workstation' | 'Server' | 'Tool';
export type Lang = 'EN' | 'PT';

export interface KitSystem {
  id: string;
  family: Family;
  name: string;
  role: Role;
  languages: Lang[];
  editions?: string[];
  includes: string[];
  note?: string;
}

export const QUICK_INSTALL_VERSION = '1.2.2';
export const QUICK_INSTALL_REPO = 'https://github.com/fernan-89/thinklab-quickinstall';

export const SYSTEMS: KitSystem[] = [
  { id: 'W10', family: 'Windows', name: 'Windows 10 22H2', role: 'Workstation', languages: ['EN', 'PT'], editions: ['Pro', 'Pro for Workstations'], includes: ['Matching Office', 'Machine drivers', 'Software profile', 'Wallpapers'] },
  { id: 'W11', family: 'Windows', name: 'Windows 11 26H2', role: 'Workstation', languages: ['EN', 'PT'], editions: ['Pro', 'Pro for Workstations'], includes: ['Matching Office', 'Machine drivers', 'Software profile', 'Wallpapers'] },
  { id: 'L21', family: 'Windows', name: 'Windows 10 Enterprise LTSC 2021', role: 'Workstation', languages: ['EN', 'PT'], includes: ['Matching Office', 'Software profile'], note: 'Appears in the menu only when its ISO is on the stick.' },
  { id: 'L24', family: 'Windows', name: 'Windows 11 Enterprise LTSC 2024', role: 'Workstation', languages: ['EN', 'PT'], includes: ['Matching Office', 'Software profile'], note: 'Appears in the menu only when its ISO is on the stick.' },
  { id: 'I10', family: 'Windows', name: 'Windows 10 IoT Enterprise LTSC', role: 'Workstation', languages: ['EN', 'PT'], includes: ['Matching Office', 'Software profile'], note: 'Appears in the menu only when its ISO is on the stick.' },
  { id: 'S19', family: 'Windows', name: 'Windows Server 2019', role: 'Server', languages: ['EN'], editions: ['Standard', 'Datacenter'], includes: ['Netdata monitoring'] },
  { id: 'alma', family: 'Linux', name: 'AlmaLinux 10', role: 'Workstation', languages: ['EN', 'PT'], includes: ['Kickstart answers', 'Server variant with Netdata (EN)'] },
  { id: 'rhel', family: 'Linux', name: 'Red Hat Enterprise Linux 10', role: 'Workstation', languages: ['EN', 'PT'], includes: ['Kickstart answers', 'Server variant with Netdata (EN)'], note: 'Red Hat media is downloaded by you; the add-on only provides the answers.' },
  { id: 'centos', family: 'Linux', name: 'CentOS Stream 10', role: 'Workstation', languages: ['EN', 'PT'], includes: ['Kickstart answers', 'Server variant with Netdata (EN)'], note: 'Network install from the boot image.' },
  { id: 'ubuntu', family: 'Linux', name: 'Ubuntu Server 26.04 LTS', role: 'Server', languages: ['EN'], includes: ['Autoinstall answers', 'Netdata monitoring'] },
  { id: 'opensuse', family: 'Linux', name: 'openSUSE Leap 16.1', role: 'Workstation', languages: ['EN'], includes: ['Interactive installer'] },
  { id: 'pe', family: 'Recovery', name: "Hiren's BootCD PE (WinPE)", role: 'Tool', languages: ['EN'], includes: ['ThinkLab shortcuts: inventory, export drivers, load stick drivers, docs'] },
  { id: 'rescue', family: 'Recovery', name: 'SystemRescue, GParted Live, Clonezilla', role: 'Tool', languages: ['EN'], includes: ['Disk, data and clone tools'] },
  { id: 'memtest', family: 'Recovery', name: 'MemTest86+', role: 'Tool', languages: ['EN'], includes: ['Memory test'] },
];

export const KIT_RULES: string[] = [
  'Every install except servers exists in PT-BR and EN-US; servers are English only.',
  'Each system has a BASE kit (system + matching Office; on servers, the system + Netdata) and one kit per machine class.',
  'Disk selection is always manual: the installer never picks a disk for you.',
  'Netdata is installed on every Linux and Windows server kit.',
  "Machine-specific kits, product keys and vendor artwork stay on the owner's stick and are never published.",
];

export const KNOWN_LIMITS: string[] = [
  'Kaspersky Password Manager cannot be installed silently (its web installer refuses silent mode); install it by hand.',
  'Lite editions in the second language need ISOs you supply: Microsoft only offers registration-gated evaluation media.',
  'Live Debian-based rescue images hang on Hyper-V with more than one virtual CPU; they boot on real hardware and with one vCPU.',
];
