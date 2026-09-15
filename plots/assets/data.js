const RAW_RECORDS = [
  {
    "kernel": "naive-ijk",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.19487500000000002,
    "gflops": 2.690381013470173
  },
  {
    "kernel": "ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.032042,
    "gflops": 16.362524187004556
  },
  {
    "kernel": "tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.032334,
    "gflops": 16.214758458588484
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.037375,
    "gflops": 14.027772575250836
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.073208,
    "gflops": 7.161621680690636
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.027375,
    "gflops": 19.152073059360728
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.041167,
    "gflops": 12.735637768115238
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.057584,
    "gflops": 9.104751319811058
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.051,
    "gflops": 10.280156862745098
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.050542,
    "gflops": 10.373313284001425
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.040375,
    "gflops": 12.985461300309597
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.06483299999999999,
    "gflops": 8.086745947279935
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.041665999999999995,
    "gflops": 12.583113329813278
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.043792,
    "gflops": 11.972232371209355
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.023458,
    "gflops": 22.350072469946284
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.03975,
    "gflops": 13.189635220125787
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.065292,
    "gflops": 8.02989646511058
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.035875,
    "gflops": 14.614299651567945
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.046458,
    "gflops": 11.285203840027553
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.042957999999999996,
    "gflops": 12.204665021649054
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.040333,
    "gflops": 12.998983462673245
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.046625,
    "gflops": 11.244782841823055
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.03325,
    "gflops": 15.768060150375938
  },
  {
    "kernel": "mps",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.231,
    "gflops": 2.2696450216450215
  },
  {
    "kernel": "naive-ijk",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.4113330000000002,
    "gflops": 2.9718741076698407
  },
  {
    "kernel": "ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.134125,
    "gflops": 31.271604846225536
  },
  {
    "kernel": "tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.20441700000000002,
    "gflops": 20.518371759687305
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.137791,
    "gflops": 30.43960781183096
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.073625,
    "gflops": 56.9684753820034
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.102833,
    "gflops": 40.78752929507065
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.14008400000000001,
    "gflops": 29.941349476028666
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.075334,
    "gflops": 55.676109060981766
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.20566700000000002,
    "gflops": 20.393665488386567
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.110375,
    "gflops": 38.00048924122311
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.110917,
    "gflops": 37.814798452897215
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.124583,
    "gflops": 33.666744258847515
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.122667,
    "gflops": 34.192602737492564
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.142292,
    "gflops": 29.476737975430805
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.078625,
    "gflops": 53.345678855325914
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.051,
    "gflops": 82.24125490196079
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.082792,
    "gflops": 50.660740168132186
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.08904100000000001,
    "gflops": 47.10531103648881
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.21333300000000002,
    "gflops": 19.660830720048
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.113541,
    "gflops": 36.94087598312504
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.067833,
    "gflops": 61.83279524715109
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.06933299999999999,
    "gflops": 60.4950600724042
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.09575,
    "gflops": 43.804741514360316
  },
  {
    "kernel": "mps",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.22375,
    "gflops": 18.74549273743017
  },
  {
    "kernel": "naive-ijk",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.663333999999999,
    "gflops": 2.455801197570081
  },
  {
    "kernel": "ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.275083,
    "gflops": 26.315488481926273
  },
  {
    "kernel": "tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.579708,
    "gflops": 21.24090781334272
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.286875,
    "gflops": 26.074352209810584
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.92725,
    "gflops": 36.18703909409545
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.3765,
    "gflops": 89.1219973439575
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.24787499999999998,
    "gflops": 135.36835905194152
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.320917,
    "gflops": 104.55797604988207
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.596,
    "gflops": 21.024080200501256
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.8296659999999999,
    "gflops": 40.443301280274234
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.54075,
    "gflops": 62.0516541840037
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.437708,
    "gflops": 76.65939850311166
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.5109999999999999,
    "gflops": 65.66425048923679
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.291875,
    "gflops": 25.973435510401547
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.715666,
    "gflops": 46.88560306064561
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.394375,
    "gflops": 85.08255340729002
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.341584,
    "gflops": 98.23186097709495
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.336542,
    "gflops": 99.70354963124959
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.615,
    "gflops": 20.776738080495356
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.827708,
    "gflops": 40.53897268118708
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.475417,
    "gflops": 70.57894858618856
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.287125,
    "gflops": 116.8634984762734
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.39725,
    "gflops": 84.46678917558214
  },
  {
    "kernel": "mps",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.28033399999999997,
    "gflops": 119.69447872894476
  },
  {
    "kernel": "naive-ijk",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 117.908208,
    "gflops": 2.276647746185745
  },
  {
    "kernel": "ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.663667,
    "gflops": 25.1729030923415
  },
  {
    "kernel": "tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.791584,
    "gflops": 19.463714682809456
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.195124999999999,
    "gflops": 26.32978565736075
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.2715000000000005,
    "gflops": 50.922025230010426
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.779792,
    "gflops": 96.5667416842699
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.487875,
    "gflops": 180.41532790052926
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.542167,
    "gflops": 174.06380502241328
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.452375,
    "gflops": 19.954502903762343
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 6.952500000000001,
    "gflops": 38.60991815893563
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 3.6444170000000002,
    "gflops": 73.65662491421811
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.965541,
    "gflops": 136.57077415327385
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.9719579999999999,
    "gflops": 136.12635563232078
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.186625,
    "gflops": 26.35175595449916
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.268958,
    "gflops": 50.946592476159424
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.7690409999999996,
    "gflops": 96.9416689749267
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.4265,
    "gflops": 188.17767683140553
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.908208,
    "gflops": 140.67410680596663
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.437917,
    "gflops": 19.975972168900878
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 6.949625,
    "gflops": 38.62589074950087
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 3.681708,
    "gflops": 72.91057737332781
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.9094579999999999,
    "gflops": 140.5820164675002
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 2.957375,
    "gflops": 90.76814945686631
  },
  {
    "kernel": "mps",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.39829200000000003,
    "gflops": 673.9664768561759
  },
  {
    "kernel": "naive-ijk",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1038.187333,
    "gflops": 2.0684934016624146
  },
  {
    "kernel": "ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 82.50745900000001,
    "gflops": 26.027751600009886
  },
  {
    "kernel": "tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 119.613833,
    "gflops": 17.953472388097452
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 81.755375,
    "gflops": 26.26718607797958
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 41.734042,
    "gflops": 51.45640213809149
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 21.874875,
    "gflops": 98.17124202995447
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 11.441583999999999,
    "gflops": 187.69111409748862
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 11.656417000000001,
    "gflops": 184.2318825759236
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 119.173209,
    "gflops": 18.019852498895116
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 61.561334,
    "gflops": 34.883643814476144
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 31.5985,
    "gflops": 67.96156931499912
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 18.051917,
    "gflops": 118.96152901655819
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 15.949749999999998,
    "gflops": 134.6405835828148
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 81.784958,
    "gflops": 26.25768479333327
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 42.122416,
    "gflops": 50.981967606036655
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 21.310708,
    "gflops": 100.77016906242626
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 11.644209,
    "gflops": 184.42503462450733
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 14.45725,
    "gflops": 148.54025820954885
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 120.2085,
    "gflops": 17.864657224738686
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 61.548167,
    "gflops": 34.89110647275653
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 31.59425,
    "gflops": 67.97071137944405
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 15.628625,
    "gflops": 137.4070750305929
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 19.048625,
    "gflops": 112.73693760048297
  },
  {
    "kernel": "mps",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 4.596834,
    "gflops": 467.1658032463212
  },
  {
    "kernel": "naive-ijk",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 24071.668125,
    "gflops": 0.7136966617680137
  },
  {
    "kernel": "ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 719.354666,
    "gflops": 23.882335092826104
  },
  {
    "kernel": "tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1166.603833,
    "gflops": 14.726395283496382
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 709.5198750000001,
    "gflops": 24.213372717712804
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 411.06816699999996,
    "gflops": 41.793236653131544
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 227.992084,
    "gflops": 75.35291963908712
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 119.880125,
    "gflops": 143.3087359893894
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 115.401625,
    "gflops": 148.87025363810952
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1177.901417,
    "gflops": 14.58515028172345
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 623.2021669999999,
    "gflops": 27.5670883281765
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 314.71375,
    "gflops": 54.58887380675296
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 168.71070799999998,
    "gflops": 101.83034252929578
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 161.511083,
    "gflops": 106.36959931721837
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 715.855334,
    "gflops": 23.999079657622556
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 412.237,
    "gflops": 41.67473852177267
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 228.434791,
    "gflops": 75.20688555711288
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 122.585708,
    "gflops": 140.14577608019363
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 122.04216699999999,
    "gflops": 140.76994539108767
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1170.5895,
    "gflops": 14.676254300931284
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 651.660083,
    "gflops": 26.363236957694706
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 304.261417,
    "gflops": 56.46417266241812
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 154.467625,
    "gflops": 111.21987007957169
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 143.120916,
    "gflops": 120.0374457077958
  },
  {
    "kernel": "mps",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.833499999999999,
    "gflops": 1585.8096814510548
  },
  {
    "kernel": "naive-ijk",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 268953.293708,
    "gflops": 0.5110142046492882
  },
  {
    "kernel": "ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 5459.0305,
    "gflops": 25.176439932328645
  },
  {
    "kernel": "tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 8610.052791999999,
    "gflops": 15.962614491713794
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 5403.81275,
    "gflops": 25.43370020954186
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 2952.9432079999997,
    "gflops": 46.54303987278038
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2164.737541,
    "gflops": 63.489892362891304
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1099.456459,
    "gflops": 125.00627227840043
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1166.248875,
    "gflops": 117.84701912102595
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 8975.901333,
    "gflops": 15.31199468143708
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 4562.543291,
    "gflops": 30.123320417169495
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2333.0378330000003,
    "gflops": 58.90986915341634
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1259.4695,
    "gflops": 109.12447937167197
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1323.22,
    "gflops": 103.86704665286196
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 5506.955292,
    "gflops": 24.95733961589605
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 3207.229208,
    "gflops": 42.85286287901628
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2306.33225,
    "gflops": 59.59200088018541
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1421.502292,
    "gflops": 96.68570655530115
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1203.949333,
    "gflops": 114.15675868147186
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 9401.160125,
    "gflops": 14.619360977217692
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 4697.3335,
    "gflops": 29.258930299924415
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2336.919667,
    "gflops": 58.81201455608272
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1274.8842499999998,
    "gflops": 107.80504463209111
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1443.61675,
    "gflops": 95.2045987773417
  },
  {
    "kernel": "mps",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 39.290375000000004,
    "gflops": 3498.0310946892205
  }
];
